from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timedelta
from emergentintegrations.llm.chat import LlmChat, UserMessage
from bson import ObjectId

ROOT_DIR = Path(__file__).parent

# Helper function to serialize MongoDB documents
def serialize_doc(doc):
    if doc is None:
        return None
    if isinstance(doc, list):
        return [serialize_doc(item) for item in doc]
    if isinstance(doc, dict):
        result = {}
        for key, value in doc.items():
            if key == '_id':
                result['_id'] = str(value)
            elif isinstance(value, ObjectId):
                result[key] = str(value)
            elif isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, dict):
                result[key] = serialize_doc(value)
            elif isinstance(value, list):
                result[key] = serialize_doc(value)
            else:
                result[key] = value
        return result
    return doc
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'habits_coach_db')]

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Pydantic Models
class WeeklyGoalsCreate(BaseModel):
    device_id: str
    goals: List[str]  # 3 goals

class WeeklyGoals(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    goals: List[str]
    week_start: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)

class DailyCheckInCreate(BaseModel):
    device_id: str
    week_id: str
    habits_completed: str  # e.g., "yyy" or "ynn"
    mood_emoji: str
    mood_scale: int  # 1-10
    language: str = "de"  # User's language preference

class DailyCheckIn(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    week_id: str
    date: datetime = Field(default_factory=datetime.utcnow)
    habits_completed: str
    mood_emoji: str
    mood_scale: int
    ai_response: str = ""

class AICoachRequest(BaseModel):
    device_id: str
    habits_completed: str
    mood_emoji: str
    mood_scale: int
    goals: List[str]
    day_of_week: int  # 0=Monday, 6=Sunday
    week_progress: Optional[List[str]] = []  # Previous days' results
    language: str = "de"  # User's language preference: "de", "en", etc.

class GoalAdviceRequest(BaseModel):
    device_id: str
    language: str = "de"  # User's language preference

# ============================================
# SUBSCRIPTION & PREMIUM SYSTEM
# ============================================

# Subscription Models
class SubscriptionStatus(BaseModel):
    device_id: str
    is_premium: bool = False
    subscription_type: Optional[str] = None  # 'stripe', 'paypal', 'revenuecat', 'promo'
    subscription_id: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class PromoCode(BaseModel):
    code: str
    duration_days: int  # 7, 30, 90, 180, 365
    description: Optional[str] = None
    max_uses: Optional[int] = None  # None = unlimited
    current_uses: int = 0
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: str = "admin"

class PromoCodeCreate(BaseModel):
    code: str
    duration_days: int  # 7=1 week, 30=1 month, 90=3 months, 180=6 months, 365=1 year
    description: Optional[str] = None
    max_uses: Optional[int] = None

class PromoCodeRedeem(BaseModel):
    device_id: str
    code: str

class StripeCheckoutRequest(BaseModel):
    device_id: str
    success_url: str
    cancel_url: str

class PayPalCheckoutRequest(BaseModel):
    device_id: str
    return_url: str
    cancel_url: str

class RevenueCatWebhook(BaseModel):
    event: dict
    api_version: str

# Admin authentication (simple password-based)
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'habits_admin_2025')

def verify_admin(password: str) -> bool:
    return password == ADMIN_PASSWORD

# Premium Features Definition
PREMIUM_FEATURES = {
    "ai_weekly_review": True,      # KI-Wochenanalyse
    "ai_coaching": True,            # KI-Coaching-Chat
    "location_reminders": True,     # Standort-basierte Erinnerungen
    "detailed_stats": True,         # Monats-/Jahres-Statistiken
    "export": True,                 # PDF/CSV Export
    "mood_correlation": True,       # Stimmungs-Korrelation
    "all_badges": True,             # Alle 20+ Badges (statt nur 5)
    "cloud_backup": True,           # Cloud-Backup & Sync
}

# Free features (always available)
FREE_FEATURES = {
    "max_habits": 3,                # Immer 3 Habits
    "basic_badges_count": 5,        # 5 Basis-Badges
    "themes": "all",                # Alle Themes kostenlos
    "time_reminders": True,         # Zeit-basierte Erinnerungen
    "weekly_chart": True,           # Basis-Wochenchart
    "companion": True,              # Wegbegleiter/in
}

# Check if user has premium subscription
async def check_premium_status(device_id: str) -> dict:
    """Check if a device has an active premium subscription"""
    subscription = await db.subscriptions.find_one({"device_id": device_id})
    
    if not subscription:
        return {"is_premium": False, "reason": "no_subscription", "features": FREE_FEATURES}
    
    # Check if subscription has expired
    if subscription.get("expires_at"):
        expires_at = subscription["expires_at"]
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
        
        if expires_at < datetime.utcnow():
            return {"is_premium": False, "reason": "expired", "expired_at": expires_at.isoformat(), "features": FREE_FEATURES}
    
    return {
        "is_premium": True,
        "subscription_type": subscription.get("subscription_type"),
        "expires_at": subscription.get("expires_at").isoformat() if subscription.get("expires_at") else None,
        "features": {**FREE_FEATURES, **PREMIUM_FEATURES}
    }

# Check specific premium feature
async def check_premium_feature(device_id: str, feature: str) -> bool:
    """Check if a specific premium feature is available for this device"""
    status = await check_premium_status(device_id)
    if status.get("is_premium"):
        return True
    return feature not in PREMIUM_FEATURES

# Helper function to get week start (Monday)
def get_week_start(dt: datetime = None) -> datetime:
    if dt is None:
        dt = datetime.utcnow()
    days_since_monday = dt.weekday()
    week_start = dt - timedelta(days=days_since_monday)
    return week_start.replace(hour=0, minute=0, second=0, microsecond=0)

# Helper function to get the "goal week" - if Sunday, goals are for NEXT week
def get_goal_week_start(dt: datetime = None) -> datetime:
    if dt is None:
        dt = datetime.utcnow()
    # If it's Sunday (weekday 6), goals are for the upcoming week (starting tomorrow)
    if dt.weekday() == 6:
        # Next Monday
        return (dt + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    # Otherwise, goals are for the current week
    return get_week_start(dt)

# AI Coach function - with multilingual support
async def get_ai_coach_response(request: AICoachRequest) -> str:
    try:
        api_key = os.environ.get('EMERGENT_LLM_KEY')
        language = request.language or "de"
        
        if not api_key:
            if language == "en":
                return "Well done! Keep going with your habits! 💪"
            return "Toll gemacht! Weiter so mit deinen Gewohnheiten! 💪"
        
        # Parse habits completed
        completed = [c == 'y' for c in request.habits_completed.lower()]
        completed_count = sum(completed)
        total_habits = len(completed)
        
        # Build context based on language
        goals_text = "\n".join([f"{i+1}. {g}" for i, g in enumerate(request.goals)])
        
        if language == "en":
            completed_text = "\n".join([
                f"- {request.goals[i]}: {'✅ Done' if completed[i] else '❌ Not done'}" 
                for i in range(min(len(completed), len(request.goals)))
            ])
            week_days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            mood_description = "very bad" if request.mood_scale <= 2 else \
                              "bad" if request.mood_scale <= 4 else \
                              "okay" if request.mood_scale <= 6 else \
                              "good" if request.mood_scale <= 8 else "excellent"
            
            system_message = """You are a friendly, motivating habit coach who speaks English. 
Your task is to support people with their daily habits.
Be encouraging, positive and give helpful tips.
Keep your responses short (2-3 sentences) but warm.
Sometimes add an inspiring quote or practical tip.
Use appropriate emojis to make the message friendlier.
Vary your responses - be creative and diverse!"""
            
            user_prompt = f"""Today is {week_days[request.day_of_week]}. 

My 3 weekly goals:
{goals_text}

Today I did:
{completed_text}

My mood: {request.mood_emoji} ({request.mood_scale}/10 - {mood_description})

Please give me a short, encouraging message based on my progress today."""
        else:
            # German (default)
            completed_text = "\n".join([
                f"- {request.goals[i]}: {'✅ Erledigt' if completed[i] else '❌ Nicht erledigt'}" 
                for i in range(min(len(completed), len(request.goals)))
            ])
            week_days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
            mood_description = "sehr schlecht" if request.mood_scale <= 2 else \
                              "schlecht" if request.mood_scale <= 4 else \
                              "okay" if request.mood_scale <= 6 else \
                              "gut" if request.mood_scale <= 8 else "ausgezeichnet"
            
            system_message = """Du bist ein freundlicher, motivierender Gewohnheits-Coach, der auf Deutsch spricht. 
Deine Aufgabe ist es, Menschen bei ihren täglichen Gewohnheiten zu unterstützen.
Sei ermutigend, positiv und gib hilfreiche Tipps.
Halte deine Antworten kurz (2-3 Sätze) aber herzlich.
Füge manchmal ein inspirierendes Zitat oder einen praktischen Tipp hinzu.
Verwende passende Emojis um die Nachricht freundlicher zu machen.
Variiere deine Antworten - sei kreativ und abwechslungsreich!"""
            
            user_prompt = f"""Heute ist {week_days[request.day_of_week]}. 

Meine 3 Wochenziele:
{goals_text}

Heute habe ich:
{completed_text}

Meine Stimmung: {request.mood_emoji} ({request.mood_scale}/10 - {mood_description})

Bitte gib mir eine kurze, ermutigende Nachricht basierend auf meinem Fortschritt heute."""
        
        chat = LlmChat(
            api_key=api_key,
            session_id=f"coach-{request.device_id}-{datetime.utcnow().isoformat()}",
            system_message=system_message
        ).with_model("openai", "gpt-4o")
        
        user_message = UserMessage(text=user_prompt)
        response = await chat.send_message(user_message)
        
        return response
    except Exception as e:
        logger.error(f"AI Coach error: {e}")
        # Fallback responses based on language
        if request.language == "en":
            fallback_responses = [
                "Well done today! Every small step counts on the way to your goals. 🌟",
                "Keep going! Consistency is the key to success. 💪",
                "Believe in yourself! You can do it! 🎯",
                "Tomorrow is a new day full of possibilities! ✨",
                "Be proud of every progress, no matter how small! 🌈"
            ]
        else:
            fallback_responses = [
                "Toll gemacht heute! Jeder kleine Schritt zählt auf dem Weg zu deinen Zielen. 🌟",
                "Weiter so! Beständigkeit ist der Schlüssel zum Erfolg. 💪",
                "Glaube an dich! Du schaffst das! 🎯",
                "Morgen ist ein neuer Tag voller Möglichkeiten! ✨",
                "Sei stolz auf jeden Fortschritt, egal wie klein! 🌈"
            ]
        import random
        return random.choice(fallback_responses)

# Sunday advice function
async def get_goal_setting_advice(device_id: str) -> str:
    try:
        api_key = os.environ.get('EMERGENT_LLM_KEY')
        if not api_key:
            return get_default_goal_advice()
        
        system_message = """Du bist ein Experte für Gewohnheitsbildung und die "Tiny Habits" Methode von BJ Fogg.
Gib praktische, umsetzbare Ratschläge auf Deutsch.
Halte deine Antworten strukturiert und leicht verständlich.
Verwende Emojis um die Nachricht freundlicher zu machen."""
        
        user_prompt = """Es ist Sonntag - Zeit, 3 neue kleine Gewohnheiten für die kommende Woche zu wählen!

Gib mir bitte Tipps, wie ich effektive "Tiny Habits" finden kann. Erkläre kurz:
1. Was macht eine gute kleine Gewohnheit aus?
2. Wie finde ich den richtigen "Anker" (bestehende Routine)?
3. Gib 3-4 konkrete Beispiele für effektive Tiny Habits.

Halte es kurz und motivierend!"""
        
        chat = LlmChat(
            api_key=api_key,
            session_id=f"advice-{device_id}-{datetime.utcnow().isoformat()}",
            system_message=system_message
        ).with_model("openai", "gpt-4o")
        
        user_message = UserMessage(text=user_prompt)
        response = await chat.send_message(user_message)
        
        return response
    except Exception as e:
        logger.error(f"Goal advice error: {e}")
        return get_default_goal_advice()

def get_default_goal_advice() -> str:
    return """🎯 **Tipps für effektive Tiny Habits**

**Was macht eine gute kleine Gewohnheit aus?**
- Sie dauert weniger als 30 Sekunden
- Sie ist so einfach, dass du nicht "Nein" sagen kannst
- Sie fühlt sich gut an nach dem Erledigen

**Finde deinen Anker:**
Verknüpfe neue Gewohnheiten mit bestehenden Routinen:
"Nachdem ich [bestehende Routine], werde ich [neue kleine Gewohnheit]."

**Beispiele:**
✨ Nach dem Aufstehen: Ein Glas Wasser trinken
✨ Nach dem Zähneputzen: 2 Kniebeugen machen
✨ Nach dem Mittagessen: 1 Minute tief atmen
✨ Vor dem Schlafengehen: 3 Dinge aufschreiben, für die du dankbar bist

**Denke daran:** Klein anfangen, groß werden! 🌱"""

# API Endpoints
@api_router.get("/")
async def root():
    return {"message": "Willkommen beim Tiny Habits Coach! 🎯"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "message": "Alles funktioniert!"}

# Weekly Goals
@api_router.post("/goals", response_model=WeeklyGoals)
async def create_weekly_goals(input: WeeklyGoalsCreate):
    if len(input.goals) != 3:
        raise HTTPException(status_code=400, detail="Bitte genau 3 Ziele angeben")
    
    # Use goal_week_start - if Sunday, goals are for next week
    week_start = get_goal_week_start()
    
    # Check if goals already exist for this week
    existing = await db.weekly_goals.find_one({
        "device_id": input.device_id,
        "week_start": week_start
    })
    
    if existing:
        # Update existing goals
        await db.weekly_goals.update_one(
            {"_id": existing["_id"]},
            {"$set": {"goals": input.goals}}
        )
        existing["goals"] = input.goals
        return WeeklyGoals(**{**existing, "id": str(existing["_id"])})
    
    goals_obj = WeeklyGoals(
        device_id=input.device_id,
        goals=input.goals,
        week_start=week_start
    )
    
    result = await db.weekly_goals.insert_one(goals_obj.dict())
    return goals_obj

@api_router.get("/goals/{device_id}")
async def get_current_goals(device_id: str):
    # Get goals for current week (Mon-Sun)
    week_start = get_week_start()
    goals = await db.weekly_goals.find_one({
        "device_id": device_id,
        "week_start": week_start
    })
    
    # If no goals for current week, check if there are goals set on Sunday for this week
    if not goals:
        # Maybe goals were set on Sunday (stored with next week's start date)
        # Try to find goals that match
        goals = await db.weekly_goals.find_one({
            "device_id": device_id,
            "week_start": {"$lte": week_start + timedelta(days=6), "$gte": week_start}
        })
    
    if not goals:
        return {"goals": None, "message": "Keine Ziele für diese Woche gesetzt"}
    
    return {
        "goals": goals["goals"],
        "id": goals.get("id", str(goals.get("_id", ""))),
        "week_start": goals["week_start"]
    }

# Daily Check-ins
@api_router.post("/checkin")
async def create_checkin(input: DailyCheckInCreate):
    # Validate habits_completed format
    if len(input.habits_completed) != 3 or not all(c in 'yYnN' for c in input.habits_completed):
        raise HTTPException(status_code=400, detail="Format muss 3 Zeichen sein (y/n), z.B. 'yyy' oder 'ynn'")
    
    if not 1 <= input.mood_scale <= 10:
        raise HTTPException(status_code=400, detail="Stimmung muss zwischen 1 und 10 liegen")
    
    # Check for existing check-in today
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    existing = await db.daily_checkins.find_one({
        "device_id": input.device_id,
        "date": {"$gte": today_start, "$lt": today_end}
    })
    
    # Get current goals
    goals_doc = await db.weekly_goals.find_one({"id": input.week_id})
    goals = goals_doc["goals"] if goals_doc else ["Ziel 1", "Ziel 2", "Ziel 3"]
    
    # Get week's progress
    week_start = get_week_start()
    week_checkins = await db.daily_checkins.find({
        "device_id": input.device_id,
        "date": {"$gte": week_start}
    }).to_list(7)
    week_progress = [c["habits_completed"] for c in week_checkins]
    
    # Get AI response
    ai_request = AICoachRequest(
        device_id=input.device_id,
        habits_completed=input.habits_completed,
        mood_emoji=input.mood_emoji,
        mood_scale=input.mood_scale,
        goals=goals,
        day_of_week=datetime.utcnow().weekday(),
        week_progress=week_progress,
        language=input.language or "de"
    )
    ai_response = await get_ai_coach_response(ai_request)
    
    checkin_obj = DailyCheckIn(
        device_id=input.device_id,
        week_id=input.week_id,
        habits_completed=input.habits_completed.lower(),
        mood_emoji=input.mood_emoji,
        mood_scale=input.mood_scale,
        ai_response=ai_response
    )
    
    if existing:
        await db.daily_checkins.update_one(
            {"_id": existing["_id"]},
            {"$set": checkin_obj.dict()}
        )
    else:
        await db.daily_checkins.insert_one(checkin_obj.dict())
    
    return {
        "checkin": checkin_obj.dict(),
        "ai_response": ai_response
    }

@api_router.get("/checkins/{device_id}")
async def get_week_checkins(device_id: str):
    week_start = get_week_start()
    checkins = await db.daily_checkins.find({
        "device_id": device_id,
        "date": {"$gte": week_start}
    }).sort("date", 1).to_list(7)
    
    return {"checkins": serialize_doc(checkins)}

@api_router.get("/today/{device_id}")
async def get_today_checkin(device_id: str):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    checkin = await db.daily_checkins.find_one({
        "device_id": device_id,
        "date": {"$gte": today_start, "$lt": today_end}
    })
    
    if checkin:
        return {"checkin": serialize_doc(checkin), "completed_today": True}
    return {"checkin": None, "completed_today": False}

# Weekly Summary
@api_router.get("/summary/{device_id}")
async def get_weekly_summary(device_id: str):
    week_start = get_week_start()
    
    # Get goals
    goals = await db.weekly_goals.find_one({
        "device_id": device_id,
        "week_start": week_start
    })
    
    # Get all check-ins for the week
    checkins = await db.daily_checkins.find({
        "device_id": device_id,
        "date": {"$gte": week_start}
    }).sort("date", 1).to_list(7)
    
    # Calculate statistics
    total_days = len(checkins)
    habit_completion = [0, 0, 0]  # Count for each habit
    mood_sum = 0
    
    for checkin in checkins:
        habits = checkin.get("habits_completed", "nnn").lower()
        for i, h in enumerate(habits[:3]):
            if h == 'y':
                habit_completion[i] += 1
        mood_sum += checkin.get("mood_scale", 5)
    
    avg_mood = mood_sum / total_days if total_days > 0 else 0
    
    # Calculate success rate for each habit (percentage)
    success_rates = [(count / 7) * 100 for count in habit_completion]
    overall_success = sum(success_rates) / 3 if success_rates else 0
    
    return {
        "week_start": week_start,
        "total_days_tracked": total_days,
        "goals": goals["goals"] if goals else [],
        "habit_completion": habit_completion,
        "success_rates": success_rates,
        "overall_success": overall_success,
        "average_mood": round(avg_mood, 1),
        "checkins": serialize_doc(checkins),
        "is_week_complete": total_days >= 7
    }

# Goal Setting Advice (for Sundays)
@api_router.post("/advice")
async def get_advice(request: GoalAdviceRequest):
    advice = await get_goal_setting_advice(request.device_id)
    return {"advice": advice}

# ==================== WEEKLY REVIEW & COACHING ====================

class WeeklyReviewRequest(BaseModel):
    device_id: str

class CoachingMessageRequest(BaseModel):
    device_id: str
    user_message: str
    conversation_history: List[dict] = []  # Previous messages in the conversation
    context: dict = {}  # Week summary data for context

# Lösungsorientierte Kurzzeitberatung Prinzipien (nach de Shazer)
COACHING_SYSTEM_PROMPT = """Du bist ein einfühlsamer, lösungsorientierter Coach für Gewohnheitsänderung. 
Du sprichst Deutsch und verwendest die Prinzipien der lösungsorientierten Kurzzeitberatung nach Steve de Shazer.

DEINE COACHING-PRINZIPIEN:

1. LÖSUNGSFOKUS statt Problemfokus
   - Frage nach dem, was funktioniert hat, nicht nur was nicht funktioniert
   - "Was hat dir geholfen, an den erfolgreichen Tagen dranzubleiben?"

2. RESSOURCEN- UND STÄRKENORIENTIERUNG
   - Erkenne und würdige die Stärken der Person
   - "Du hast trotz Stress 5 von 7 Tagen geschafft - das zeigt echte Ausdauer!"

3. KLEINE SCHRITTE WÜRDIGEN
   - Jeder Fortschritt zählt, egal wie klein
   - "Auch wenn es nur 3 Tage waren - das sind 3 Tage mehr als nichts!"

4. AUSNAHMEN ERFORSCHEN
   - Wann hat es funktioniert? Was war anders?
   - "An welchen Tagen hat es gut geklappt? Was war an diesen Tagen besonders?"

5. ZUKUNFTSORIENTIERUNG (Wunderfrage)
   - Wie würde es aussehen, wenn es funktioniert?
   - "Stell dir vor, nächste Woche läuft alles perfekt - wie würde das aussehen?"

6. SKALIERUNGSFRAGEN
   - "Auf einer Skala von 1-10, wie zufrieden bist du mit dieser Woche?"
   - "Was müsste passieren, um einen Punkt höher zu kommen?"

7. KOMPLIMENTE UND WERTSCHÄTZUNG
   - Sei ehrlich anerkennend, nicht übertrieben
   - Würdige Anstrengung, nicht nur Ergebnis

8. DER NUTZER IST EXPERTE SEINES LEBENS
   - Stelle Fragen, gib keine Ratschläge
   - Die Person findet ihre eigenen Lösungen

DEIN STIL:
- Warm, herzlich, empathisch
- Kurze Antworten (2-4 Sätze)
- Stelle immer eine offene Frage am Ende
- Verwende passende Emojis sparsam
- Sei ehrlich, aber ermutigend
- Vermeide Belehrungen

WICHTIG: Du führst einen Dialog - reagiere auf das, was die Person sagt, und stelle Folgefragen."""

@api_router.post("/weekly-review")
async def get_weekly_review(request: WeeklyReviewRequest):
    """Generiert einen ehrlichen, aufbauenden Wochen-Auswertungstext (Premium Feature)"""
    
    # Check premium status
    premium_status = await check_premium_status(request.device_id)
    if not premium_status.get("is_premium"):
        raise HTTPException(
            status_code=403, 
            detail="Die KI-Wochenanalyse ist nur für Premium-Nutzer verfügbar. Schließe ein Abo ab oder nutze einen Promo-Code."
        )
    
    try:
        # Get week's data
        device_id = request.device_id
        week_start = get_week_start()
        week_end = week_start + timedelta(days=7)
        
        # Get goals
        goals_doc = await db.goals.find_one({"device_id": device_id})
        goals = goals_doc.get("goals", []) if goals_doc else []
        
        # Get all checkins for this week
        checkins = await db.daily_checkins.find({
            "device_id": device_id,
            "date": {"$gte": week_start.strftime("%Y-%m-%d"), "$lt": week_end.strftime("%Y-%m-%d")}
        }).to_list(length=7)
        
        total_days = len(checkins)
        
        # Calculate stats
        habit_stats = []
        moods = []
        
        for i, goal in enumerate(goals):
            completed_days = 0
            for checkin in checkins:
                results = checkin.get("results", "")
                if len(results) > i and results[i].lower() == 'y':
                    completed_days += 1
            habit_stats.append({
                "goal": goal,
                "completed": completed_days,
                "total": total_days,
                "rate": round((completed_days / total_days * 100) if total_days > 0 else 0)
            })
        
        for checkin in checkins:
            moods.append(checkin.get("mood", 5))
        
        avg_mood = sum(moods) / len(moods) if moods else 5
        overall_success = sum(h["rate"] for h in habit_stats) / len(habit_stats) if habit_stats else 0
        
        # Generate AI review
        api_key = os.environ.get('EMERGENT_LLM_KEY')
        
        if api_key and total_days > 0:
            habits_text = "\n".join([
                f"- {h['goal']}: {h['completed']}/{h['total']} Tage ({h['rate']}%)" 
                for h in habit_stats
            ])
            
            mood_trend = "gleichbleibend"
            if len(moods) >= 3:
                if moods[-1] > moods[0]:
                    mood_trend = "verbessert"
                elif moods[-1] < moods[0]:
                    mood_trend = "verschlechtert"
            
            prompt = f"""Schreibe eine ehrliche, aber aufbauende Wochen-Auswertung für diese Person.

WOCHENDATEN:
- Tage mit Check-in: {total_days}/7
- Durchschnittliche Stimmung: {avg_mood:.1f}/10 (Trend: {mood_trend})
- Gesamterfolgsrate: {overall_success:.0f}%

GEWOHNHEITEN:
{habits_text}

AUFGABE:
1. Würdige ehrlich, was gut gelaufen ist (auch Teilerfolge!)
2. Sprich sanft an, was noch nicht so gut lief - ohne Vorwürfe
3. Gib eine klare Empfehlung: 
   - Bei >70% Erfolg: Ermutigung weiterzumachen oder leicht zu steigern
   - Bei 40-70%: Anpassung der Gewohnheiten vorschlagen (kleiner machen?)
   - Bei <40%: Sanft ermutigen, neu anzufangen mit winzigeren Schritten

Schreibe 3-4 Absätze, herzlich und ermutigend. Nutze "du" als Anrede."""

            system = """Du bist ein herzlicher Gewohnheits-Coach. 
Schreibe eine ehrliche aber liebevolle Wochen-Auswertung auf Deutsch.
Sei ermutigend ohne zu beschönigen. Nutze passende Emojis."""

            chat = LlmChat(
                api_key=api_key,
                session_id=f"review-{device_id}-{datetime.utcnow().isoformat()}",
                system_message=system
            ).with_model("openai", "gpt-4o")
            
            review_text = await chat.send_message(UserMessage(text=prompt))
        else:
            # Fallback
            if overall_success >= 70:
                review_text = f"""🌟 Was für eine tolle Woche, du hast {overall_success:.0f}% deiner Gewohnheiten geschafft! 

Das zeigt echte Beständigkeit. Deine durchschnittliche Stimmung lag bei {avg_mood:.1f}/10 - du bist auf einem guten Weg.

Meine Empfehlung: Mach genau so weiter! Wenn du magst, kannst du nächste Woche eine kleine Steigerung versuchen. 💪"""
            elif overall_success >= 40:
                review_text = f"""💜 Du hast diese Woche {overall_success:.0f}% geschafft - das ist ein solider Anfang!

Jede Gewohnheit braucht Zeit, sich zu festigen. Vielleicht waren manche Ziele noch etwas zu groß?

Meine Empfehlung: Überlege, ob du deine Gewohnheiten noch kleiner machen kannst. Lieber winzig und täglich als groß und selten! 🌱"""
            else:
                review_text = f"""💜 Diese Woche war herausfordernd - {overall_success:.0f}% ist vielleicht weniger als du wolltest.

Aber weißt du was? Du hast es versucht, und das zählt! Manchmal müssen wir unsere Ziele anpassen.

Meine Empfehlung: Lass uns nächste Woche mit winzigen Schritten starten. Was wäre so klein, dass du es auf jeden Fall schaffst? 🌟"""
        
        # Recommendation for next week
        if overall_success >= 80:
            recommendation = "continue_or_level_up"
            recommendation_text = "Du könntest deine Gewohnheiten beibehalten oder leicht steigern!"
        elif overall_success >= 50:
            recommendation = "adjust_and_continue"
            recommendation_text = "Behalte die funktionierenden Gewohnheiten bei und passe die anderen an."
        else:
            recommendation = "simplify"
            recommendation_text = "Mach deine Gewohnheiten noch kleiner - winzige Schritte führen zum Ziel!"
        
        return {
            "review_text": review_text,
            "stats": {
                "total_days": total_days,
                "overall_success": round(overall_success),
                "average_mood": round(avg_mood, 1),
                "habit_stats": habit_stats
            },
            "recommendation": recommendation,
            "recommendation_text": recommendation_text
        }
        
    except Exception as e:
        logger.error(f"Weekly review error: {e}")
        return {
            "review_text": "Diese Woche hast du den ersten Schritt getan - und das ist das Wichtigste! 💜 Weiter so!",
            "stats": {"total_days": 0, "overall_success": 0, "average_mood": 5, "habit_stats": []},
            "recommendation": "continue",
            "recommendation_text": "Jeder Tag ist eine neue Chance!"
        }

@api_router.post("/coaching/message")
async def coaching_message(request: CoachingMessageRequest):
    """Führt einen lösungsorientierten Coaching-Dialog (Premium Feature)"""
    
    # Check premium status
    premium_status = await check_premium_status(request.device_id)
    if not premium_status.get("is_premium"):
        raise HTTPException(
            status_code=403, 
            detail="Diese Funktion ist nur für Premium-Nutzer verfügbar. Schließe ein Abo ab oder nutze einen Promo-Code."
        )
    
    try:
        api_key = os.environ.get('EMERGENT_LLM_KEY')
        
        if not api_key:
            return {
                "coach_message": "Das klingt interessant! Was glaubst du, hat dir dabei geholfen? 🤔",
                "suggested_questions": [
                    "Was hat diese Woche besonders gut funktioniert?",
                    "Gab es Momente, wo es leicht fiel?",
                    "Was würdest du nächste Woche anders machen?"
                ]
            }
        
        # Build conversation context
        context = request.context
        history = request.conversation_history
        
        # Create context summary
        context_summary = ""
        if context:
            context_summary = f"""
KONTEXT DER WOCHE:
- Erfolgsrate: {context.get('overall_success', 0)}%
- Durchschnittliche Stimmung: {context.get('average_mood', 5)}/10
- Check-ins: {context.get('total_days', 0)}/7 Tage
"""
            if context.get('habit_stats'):
                context_summary += "GEWOHNHEITEN:\n"
                for h in context.get('habit_stats', []):
                    context_summary += f"- {h.get('goal', 'Ziel')}: {h.get('rate', 0)}%\n"
        
        # Build message history for the LLM
        messages_for_llm = f"{context_summary}\n\nBISHERIGER DIALOG:\n"
        for msg in history[-6:]:  # Last 6 messages for context
            role = "Nutzer" if msg.get("role") == "user" else "Coach"
            messages_for_llm += f"{role}: {msg.get('content', '')}\n"
        
        messages_for_llm += f"\nNutzer: {request.user_message}\n\nCoach:"
        
        chat = LlmChat(
            api_key=api_key,
            session_id=f"coaching-{request.device_id}-{datetime.utcnow().isoformat()}",
            system_message=COACHING_SYSTEM_PROMPT
        ).with_model("openai", "gpt-4o")
        
        coach_response = await chat.send_message(UserMessage(text=messages_for_llm))
        
        return {
            "coach_message": coach_response,
            "suggested_questions": []  # The AI asks its own questions
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Coaching error: {e}")
        return {
            "coach_message": "Das verstehe ich. Was denkst du, könnte dir nächste Woche dabei helfen? 💜",
            "suggested_questions": [
                "Was hat gut funktioniert?",
                "Was war schwierig?",
                "Was möchtest du ändern?"
            ]
        }

@api_router.post("/coaching/start")
async def start_coaching_session(request: WeeklyReviewRequest):
    """Startet eine neue Coaching-Reflexionssitzung mit einer ersten Frage (Premium Feature)"""
    
    # Check premium status
    premium_status = await check_premium_status(request.device_id)
    if not premium_status.get("is_premium"):
        raise HTTPException(
            status_code=403, 
            detail="Diese Funktion ist nur für Premium-Nutzer verfügbar. Schließe ein Abo ab oder nutze einen Promo-Code."
        )
    
    try:
        device_id = request.device_id
        
        # Get week stats for context
        week_start = get_week_start()
        week_end = week_start + timedelta(days=7)
        
        goals_doc = await db.goals.find_one({"device_id": device_id})
        goals = goals_doc.get("goals", []) if goals_doc else []
        
        checkins = await db.daily_checkins.find({
            "device_id": device_id,
            "date": {"$gte": week_start.strftime("%Y-%m-%d"), "$lt": week_end.strftime("%Y-%m-%d")}
        }).to_list(length=7)
        
        total_days = len(checkins)
        
        # Calculate habit success for personalized question
        habit_success = []
        for i, goal in enumerate(goals):
            completed = 0
            for checkin in checkins:
                results = checkin.get("results", "")
                if len(results) > i and results[i].lower() == 'y':
                    completed += 1
            rate = (completed / total_days * 100) if total_days > 0 else 0
            habit_success.append({"goal": goal, "rate": rate, "completed": completed})
        
        # Find best and worst performing habits
        best_habit = max(habit_success, key=lambda x: x["rate"]) if habit_success else None
        worst_habit = min(habit_success, key=lambda x: x["rate"]) if habit_success else None
        
        api_key = os.environ.get('EMERGENT_LLM_KEY')
        
        if api_key and total_days > 0:
            context_info = f"""Die Person hat diese Woche {total_days} von 7 Tagen eingecheckt.

Ihre Gewohnheiten und Erfolgsraten:
{chr(10).join([f"- {h['goal']}: {h['rate']:.0f}% ({h['completed']}/{total_days} Tage)" for h in habit_success])}

Beste Gewohnheit: {best_habit['goal']} ({best_habit['rate']:.0f}%)
Schwächste Gewohnheit: {worst_habit['goal']} ({worst_habit['rate']:.0f}%)

Stelle eine persönliche, einfühlsame Eröffnungsfrage für die Reflexion.
Die Frage sollte auf die Daten eingehen aber nicht überwältigend sein.
Beginne mit einer kurzen Anerkennung und stelle dann EINE offene Frage."""

            chat = LlmChat(
                api_key=api_key,
                session_id=f"coaching-start-{device_id}-{datetime.utcnow().isoformat()}",
                system_message=COACHING_SYSTEM_PROMPT
            ).with_model("openai", "gpt-4o")
            
            opening_message = await chat.send_message(UserMessage(text=context_info))
        else:
            # Fallback opening
            if total_days == 0:
                opening_message = "Hey! 💜 Ich sehe, du hattest diese Woche noch keine Check-ins. Das ist okay - jede Woche ist ein Neustart! Was hat dich davon abgehalten, und wie kann ich dir helfen?"
            elif best_habit and best_habit["rate"] > 50:
                opening_message = f"Hallo! 💜 Du hast diese Woche '{best_habit['goal']}' an {best_habit['completed']} von {total_days} Tagen geschafft - toll! Was glaubst du, hat dir dabei besonders geholfen?"
            else:
                opening_message = f"Hey! 💜 Du hast diese Woche {total_days} mal eingecheckt - das zeigt schon Engagement! Lass uns schauen, was gut lief. Welche Gewohnheit fiel dir am leichtesten?"
        
        return {
            "opening_message": opening_message,
            "context": {
                "total_days": total_days,
                "habit_stats": habit_success,
                "overall_success": sum(h["rate"] for h in habit_success) / len(habit_success) if habit_success else 0,
                "average_mood": 5  # Placeholder
            }
        }
        
    except Exception as e:
        logger.error(f"Start coaching error: {e}")
        return {
            "opening_message": "Hallo! 💜 Schön, dass du dir Zeit für eine Reflexion nimmst. Wie fühlst du dich, wenn du an diese Woche zurückdenkst?",
            "context": {}
        }

# ==================== SETTINGS & NOTIFICATIONS ====================

class LocationSettings(BaseModel):
    enabled: bool = False
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    radius: int = 100  # meters

class HabitReminderSettings(BaseModel):
    enabled: bool = True
    use_same_time: bool = True
    time: str = "08:00"  # Default time for all
    individual_times: List[str] = ["08:00", "12:00", "18:00"]  # Individual times
    days: List[int] = [0, 1, 2, 3, 4, 5, 6]  # 0=Monday, 6=Sunday
    locations: List[LocationSettings] = []  # One per goal

class CheckinReminderSettings(BaseModel):
    enabled: bool = True
    time: str = "20:00"
    days: List[int] = [0, 1, 2, 3, 4, 5, 6]

class AppearanceSettings(BaseModel):
    color_palette: str = "sonnenuntergang"
    notification_sound: str = "default"

class UserSettings(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    habit_reminders: HabitReminderSettings = HabitReminderSettings()
    checkin_reminder: CheckinReminderSettings = CheckinReminderSettings()
    appearance: AppearanceSettings = AppearanceSettings()
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class UserSettingsUpdate(BaseModel):
    habit_reminders: Optional[HabitReminderSettings] = None
    checkin_reminder: Optional[CheckinReminderSettings] = None
    appearance: Optional[AppearanceSettings] = None

class NotificationMessageRequest(BaseModel):
    device_id: str
    notification_type: str  # "habit_reminder" or "checkin_reminder"
    goal_index: Optional[int] = None  # For individual habit reminders

# Color Palettes
COLOR_PALETTES = {
    "sonnenuntergang": {
        "name": "Sonnenuntergang",
        "primary": "#FF6B6B",
        "secondary": "#4ECDC4",
        "accent": "#FFE66D",
        "background": "#FFF9F0",
        "card": "#FFFFFF",
        "text": "#2D3436"
    },
    "ozean": {
        "name": "Ozean",
        "primary": "#0077B6",
        "secondary": "#00B4D8",
        "accent": "#90E0EF",
        "background": "#CAF0F8",
        "card": "#FFFFFF",
        "text": "#03045E"
    },
    "wald": {
        "name": "Wald",
        "primary": "#2D6A4F",
        "secondary": "#40916C",
        "accent": "#95D5B2",
        "background": "#D8F3DC",
        "card": "#FFFFFF",
        "text": "#1B4332"
    },
    "nacht": {
        "name": "Nacht",
        "primary": "#7B2CBF",
        "secondary": "#9D4EDD",
        "accent": "#C77DFF",
        "background": "#10002B",
        "card": "#240046",
        "text": "#E0AAFF"
    },
    "lavendel": {
        "name": "Lavendel",
        "primary": "#7251B5",
        "secondary": "#9B7ED9",
        "accent": "#D4C1EC",
        "background": "#F5F0FF",
        "card": "#FFFFFF",
        "text": "#4A3072"
    },
    "koralle": {
        "name": "Koralle",
        "primary": "#FF7F50",
        "secondary": "#FF6B6B",
        "accent": "#FFB4A2",
        "background": "#FFF5F3",
        "card": "#FFFFFF",
        "text": "#8B4513"
    },
    "minze": {
        "name": "Minze",
        "primary": "#00A896",
        "secondary": "#02C39A",
        "accent": "#80ED99",
        "background": "#E8FFF5",
        "card": "#FFFFFF",
        "text": "#004E45"
    },
    "monochrom_grau": {
        "name": "Elegantes Grau",
        "primary": "#4A4A4A",
        "secondary": "#6B6B6B",
        "accent": "#9E9E9E",
        "background": "#F5F5F5",
        "card": "#FFFFFF",
        "text": "#2C2C2C"
    },
    "monochrom_blau": {
        "name": "Tiefes Blau",
        "primary": "#1A365D",
        "secondary": "#2C5282",
        "accent": "#4299E1",
        "background": "#EBF8FF",
        "card": "#FFFFFF",
        "text": "#1A202C"
    },
    "regenbogen": {
        "name": "Regenbogen",
        "primary": "#FF6B6B",
        "secondary": "#4ECDC4",
        "accent": "#FFE66D",
        "background": "#FFF0F5",
        "card": "#FFFFFF",
        "text": "#2D3436",
        "extra": ["#A78BFA", "#F472B6", "#34D399"]
    },
    "fruehling": {
        "name": "Fruehling",
        "primary": "#F472B6",
        "secondary": "#A78BFA",
        "accent": "#FBBF24",
        "background": "#FDF2F8",
        "card": "#FFFFFF",
        "text": "#831843"
    }
}

@api_router.get("/settings/{device_id}")
async def get_settings(device_id: str):
    settings = await db.user_settings.find_one({"device_id": device_id})
    
    if not settings:
        # Return default settings
        default = UserSettings(device_id=device_id)
        return serialize_doc(default.dict())
    
    return serialize_doc(settings)

@api_router.post("/settings/{device_id}")
async def update_settings(device_id: str, update: UserSettingsUpdate):
    existing = await db.user_settings.find_one({"device_id": device_id})
    
    if existing:
        update_data = {"updated_at": datetime.utcnow()}
        if update.habit_reminders:
            update_data["habit_reminders"] = update.habit_reminders.dict()
        if update.checkin_reminder:
            update_data["checkin_reminder"] = update.checkin_reminder.dict()
        if update.appearance:
            update_data["appearance"] = update.appearance.dict()
        
        await db.user_settings.update_one(
            {"_id": existing["_id"]},
            {"$set": update_data}
        )
        updated = await db.user_settings.find_one({"_id": existing["_id"]})
        return serialize_doc(updated)
    else:
        new_settings = UserSettings(device_id=device_id)
        if update.habit_reminders:
            new_settings.habit_reminders = update.habit_reminders
        if update.checkin_reminder:
            new_settings.checkin_reminder = update.checkin_reminder
        if update.appearance:
            new_settings.appearance = update.appearance
        
        await db.user_settings.insert_one(new_settings.dict())
        return serialize_doc(new_settings.dict())

@api_router.get("/color-palettes")
async def get_color_palettes():
    return {"palettes": COLOR_PALETTES}

# Generate personalized notification message
async def generate_notification_message(device_id: str, notification_type: str, goal_index: Optional[int] = None) -> str:
    try:
        api_key = os.environ.get('EMERGENT_LLM_KEY')
        if not api_key:
            return get_fallback_notification(notification_type)
        
        # Get user's goals and progress
        week_start = get_week_start()
        goals_doc = await db.weekly_goals.find_one({
            "device_id": device_id,
            "week_start": week_start
        })
        goals = goals_doc["goals"] if goals_doc else []
        
        # Get this week's check-ins
        checkins = await db.daily_checkins.find({
            "device_id": device_id,
            "date": {"$gte": week_start}
        }).to_list(7)
        
        # Calculate progress
        total_days = len(checkins)
        habit_success = [0, 0, 0]
        for checkin in checkins:
            habits = checkin.get("habits_completed", "nnn").lower()
            for i, h in enumerate(habits[:3]):
                if h == 'y':
                    habit_success[i] += 1
        
        success_rates = [(count / max(total_days, 1)) * 100 for count in habit_success]
        overall_success = sum(success_rates) / 3 if success_rates else 0
        
        # Build context for AI
        if notification_type == "habit_reminder":
            if goal_index is not None and goal_index < len(goals):
                specific_goal = goals[goal_index]
                specific_rate = success_rates[goal_index] if goal_index < len(success_rates) else 0
                context = f"Erinnerung an spezifische Gewohnheit: '{specific_goal}' (Erfolgsrate diese Woche: {specific_rate:.0f}%)"
            else:
                context = f"Erinnerung an alle 3 Gewohnheiten. Gesamterfolg diese Woche: {overall_success:.0f}%"
        else:
            context = f"Erinnerung an den taeglichen Check-In. Bereits {total_days} von 7 Tagen erfasst. Gesamterfolg: {overall_success:.0f}%"
        
        goals_text = "\n".join([f"- {g}" for g in goals]) if goals else "Keine Ziele gesetzt"
        
        performance = "sehr gut" if overall_success >= 80 else \
                     "gut" if overall_success >= 60 else \
                     "okay" if overall_success >= 40 else "ausbaufaehig"
        
        system_message = """Du bist ein warmherziger, persoenlicher Gewohnheits-Coach.
Schreibe SEHR KURZE Push-Benachrichtigungen (max 1-2 Saetze, unter 100 Zeichen wenn moeglich).
Sei ermutigend und persoenlich. Verwende gelegentlich ein Emoji.
Variiere stark zwischen:
- Motivierenden Nachrichten
- Kurzen weisen Zitaten
- Persoenlichen Ermutigungen
- Sanften Erinnerungen
Beziehe dich auf den Fortschritt des Nutzers."""

        user_prompt = f"""Erstelle eine kurze Push-Benachrichtigung.

Kontext: {context}
Ziele des Nutzers:
{goals_text}
Bisherige Leistung: {performance}

Schreibe NUR die Benachrichtigung, nichts anderes. Max 100 Zeichen."""

        chat = LlmChat(
            api_key=api_key,
            session_id=f"notification-{device_id}-{datetime.utcnow().isoformat()}",
            system_message=system_message
        ).with_model("openai", "gpt-4o")
        
        response = await chat.send_message(UserMessage(text=user_prompt))
        return response.strip()
        
    except Exception as e:
        logger.error(f"Notification generation error: {e}")
        return get_fallback_notification(notification_type)

def get_fallback_notification(notification_type: str) -> str:
    import random
    if notification_type == "habit_reminder":
        messages = [
            "Zeit fuer deine Tiny Habits! Du schaffst das!",
            "Kleine Schritte, grosse Wirkung. Los geht's!",
            "Deine Gewohnheiten warten auf dich!",
            "Jetzt ist der perfekte Moment!",
            "Ein kleiner Schritt fuer dich, ein grosser fuer deine Ziele!"
        ]
    else:
        messages = [
            "Zeit fuer deinen Check-In!",
            "Wie lief dein Tag? Check jetzt ein!",
            "Vergiss nicht einzuchecken!",
            "Dein Coach wartet auf deinen Tagesbericht!",
            "Noch schnell einchecken vor dem Schlafengehen?"
        ]
    return random.choice(messages)

@api_router.post("/notification-message")
async def get_notification_message(request: NotificationMessageRequest):
    message = await generate_notification_message(
        request.device_id,
        request.notification_type,
        request.goal_index
    )
    return {"message": message}

# Batch pre-generate notification messages for the day
@api_router.post("/pregenerate-notifications/{device_id}")
async def pregenerate_notifications(device_id: str):
    messages = {
        "habit_all": await generate_notification_message(device_id, "habit_reminder"),
        "habit_0": await generate_notification_message(device_id, "habit_reminder", 0),
        "habit_1": await generate_notification_message(device_id, "habit_reminder", 1),
        "habit_2": await generate_notification_message(device_id, "habit_reminder", 2),
        "checkin": await generate_notification_message(device_id, "checkin_reminder")
    }
    
    # Store in database for quick retrieval
    await db.notification_cache.update_one(
        {"device_id": device_id, "date": datetime.utcnow().strftime("%Y-%m-%d")},
        {"$set": {
            "messages": messages,
            "generated_at": datetime.utcnow()
        }},
        upsert=True
    )
    
    return {"messages": messages}

@api_router.get("/cached-notifications/{device_id}")
async def get_cached_notifications(device_id: str):
    today = datetime.utcnow().strftime("%Y-%m-%d")
    cached = await db.notification_cache.find_one({
        "device_id": device_id,
        "date": today
    })
    
    if cached:
        return {"messages": cached["messages"], "cached": True}
    
    # Generate if not cached
    messages = await pregenerate_notifications(device_id)
    return {"messages": messages["messages"], "cached": False}

# ==================== GAMIFICATION ====================

# Badge definitions
BADGES = {
    "first_checkin": {
        "id": "first_checkin",
        "name_de": "Erster Schritt",
        "name_en": "First Step",
        "description_de": "Dein erster Check-In!",
        "description_en": "Your first check-in!",
        "icon": "footsteps",
        "color": "#4ECDC4"
    },
    "week_warrior": {
        "id": "week_warrior",
        "name_de": "Wochen-Krieger",
        "name_en": "Week Warrior",
        "description_de": "7 Tage am Stück eingecheckt",
        "description_en": "Checked in 7 days in a row",
        "icon": "shield",
        "color": "#FF6B6B"
    },
    "perfect_week": {
        "id": "perfect_week",
        "name_de": "Perfekte Woche",
        "name_en": "Perfect Week",
        "description_de": "Alle Habits eine Woche lang erledigt",
        "description_en": "Completed all habits for a week",
        "icon": "trophy",
        "color": "#FFE66D"
    },
    "morning_person": {
        "id": "morning_person",
        "name_de": "Frühaufsteher",
        "name_en": "Early Bird",
        "description_de": "10x vor 8 Uhr eingecheckt",
        "description_en": "Checked in before 8 AM 10 times",
        "icon": "sunny",
        "color": "#FFA500"
    },
    "streak_master_7": {
        "id": "streak_master_7",
        "name_de": "Streak-Meister",
        "name_en": "Streak Master",
        "description_de": "7-Tage-Streak erreicht",
        "description_en": "Reached a 7-day streak",
        "icon": "flame",
        "color": "#FF4500"
    },
    "streak_master_14": {
        "id": "streak_master_14",
        "name_de": "Streak-Legende",
        "name_en": "Streak Legend",
        "description_de": "14-Tage-Streak erreicht",
        "description_en": "Reached a 14-day streak",
        "icon": "flame",
        "color": "#FF6347"
    },
    "streak_master_30": {
        "id": "streak_master_30",
        "name_de": "Streak-Gott",
        "name_en": "Streak God",
        "description_de": "30-Tage-Streak erreicht",
        "description_en": "Reached a 30-day streak",
        "icon": "flame",
        "color": "#DC143C"
    },
    "habit_hero": {
        "id": "habit_hero",
        "name_de": "Habit-Held",
        "name_en": "Habit Hero",
        "description_de": "50 Habits insgesamt erledigt",
        "description_en": "Completed 50 habits in total",
        "icon": "star",
        "color": "#A78BFA"
    },
    "journal_writer": {
        "id": "journal_writer",
        "name_de": "Tagebuch-Schreiber",
        "name_en": "Journal Writer",
        "description_de": "10 Journal-Einträge geschrieben",
        "description_en": "Wrote 10 journal entries",
        "icon": "book",
        "color": "#F472B6"
    },
    "gratitude_guru": {
        "id": "gratitude_guru",
        "name_de": "Dankbarkeits-Guru",
        "name_en": "Gratitude Guru",
        "description_de": "30 Dankbarkeiten aufgeschrieben",
        "description_en": "Wrote down 30 gratitudes",
        "icon": "heart",
        "color": "#EC4899"
    },
    "social_butterfly": {
        "id": "social_butterfly",
        "name_de": "Sozialer Schmetterling",
        "name_en": "Social Butterfly",
        "description_de": "Einen Partner eingeladen",
        "description_en": "Invited a partner",
        "icon": "people",
        "color": "#06B6D4"
    },
    "challenger": {
        "id": "challenger",
        "name_de": "Herausforderer",
        "name_en": "Challenger",
        "description_de": "Erste Wochen-Challenge abgeschlossen",
        "description_en": "Completed first weekly challenge",
        "icon": "flag",
        "color": "#8B5CF6"
    }
}

def get_localized_badge(badge_data: dict, language: str = "de") -> dict:
    """Return badge with localized name and description"""
    return {
        "id": badge_data["id"],
        "name": badge_data.get(f"name_{language}", badge_data.get("name_de", "")),
        "description": badge_data.get(f"description_{language}", badge_data.get("description_de", "")),
        "icon": badge_data["icon"],
        "color": badge_data["color"]
    }

def get_all_localized_badges(language: str = "de") -> list:
    """Return all badges with localized names and descriptions"""
    return [get_localized_badge(b, language) for b in BADGES.values()]

# Level definitions
LEVELS = [
    {"level": 1, "name": "Anfaenger", "xp_required": 0, "icon": "leaf"},
    {"level": 2, "name": "Lehrling", "xp_required": 100, "icon": "fitness"},
    {"level": 3, "name": "Fortgeschritten", "xp_required": 300, "icon": "rocket"},
    {"level": 4, "name": "Experte", "xp_required": 600, "icon": "star"},
    {"level": 5, "name": "Meister", "xp_required": 1000, "icon": "trophy"},
    {"level": 6, "name": "Grossmeister", "xp_required": 1500, "icon": "medal"},
    {"level": 7, "name": "Legende", "xp_required": 2500, "icon": "diamond"},
    {"level": 8, "name": "Champion", "xp_required": 4000, "icon": "ribbon"},
    {"level": 9, "name": "Held", "xp_required": 6000, "icon": "shield"},
    {"level": 10, "name": "Unsterblich", "xp_required": 10000, "icon": "infinite"}
]

# Weekly Challenges
WEEKLY_CHALLENGES = [
    {
        "id": "early_bird",
        "name_de": "Frühaufsteher-Challenge",
        "name_en": "Early Bird Challenge",
        "description_de": "Check 5x vor 7:00 Uhr ein",
        "description_en": "Check in 5 times before 7:00 AM",
        "target": 5,
        "xp_reward": 50,
        "type": "early_checkin"
    },
    {
        "id": "perfect_3",
        "name_de": "Perfekte 3 Tage",
        "name_en": "Perfect 3 Days",
        "description_de": "Erledige alle Habits an 3 aufeinanderfolgenden Tagen",
        "description_en": "Complete all habits on 3 consecutive days",
        "target": 3,
        "xp_reward": 75,
        "type": "perfect_days"
    },
    {
        "id": "mood_tracker",
        "name_de": "Stimmungs-Tracker",
        "name_en": "Mood Tracker",
        "description_de": "Tracke deine Stimmung 7 Tage lang",
        "description_en": "Track your mood for 7 days",
        "target": 7,
        "xp_reward": 40,
        "type": "mood_tracking"
    },
    {
        "id": "journal_week",
        "name_de": "Reflexions-Woche",
        "name_en": "Reflection Week",
        "description_de": "Schreibe 5 Journal-Einträge",
        "description_en": "Write 5 journal entries",
        "target": 5,
        "xp_reward": 60,
        "type": "journal_entries"
    },
    {
        "id": "gratitude_master",
        "name_de": "Dankbarkeits-Meister",
        "name_en": "Gratitude Master",
        "description_de": "Schreibe 10 Dankbarkeiten auf",
        "description_en": "Write down 10 gratitudes",
        "target": 10,
        "xp_reward": 50,
        "type": "gratitudes"
    }
]

class GamificationProfile(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    xp: int = 0
    level: int = 1
    current_streak: int = 0
    longest_streak: int = 0
    total_checkins: int = 0
    total_habits_completed: int = 0
    badges: List[str] = []
    active_challenge: Optional[str] = None
    challenge_progress: int = 0
    challenge_start_date: Optional[datetime] = None
    last_checkin_date: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

@api_router.get("/gamification/{device_id}")
async def get_gamification_profile(device_id: str, language: str = "de"):
    profile = await db.gamification.find_one({"device_id": device_id})
    
    if not profile:
        # Create new profile
        new_profile = GamificationProfile(device_id=device_id)
        await db.gamification.insert_one(new_profile.dict())
        profile = new_profile.dict()
    
    # Calculate level info
    current_level = None
    next_level = None
    for i, lvl in enumerate(LEVELS):
        if profile.get("xp", 0) >= lvl["xp_required"]:
            current_level = lvl
            if i + 1 < len(LEVELS):
                next_level = LEVELS[i + 1]
    
    # Get localized badges
    badges_earned = [get_localized_badge(BADGES[b], language) for b in profile.get("badges", []) if b in BADGES]
    all_badges = get_all_localized_badges(language)
    
    return {
        "profile": serialize_doc(profile),
        "current_level": current_level,
        "next_level": next_level,
        "badges_earned": badges_earned,
        "all_badges": all_badges,
        "levels": LEVELS
    }

@api_router.post("/gamification/{device_id}/add-xp")
async def add_xp(device_id: str, xp: int):
    profile = await db.gamification.find_one({"device_id": device_id})
    if not profile:
        new_profile = GamificationProfile(device_id=device_id)
        await db.gamification.insert_one(new_profile.dict())
        profile = new_profile.dict()
    
    new_xp = profile.get("xp", 0) + xp
    
    # Calculate new level
    new_level = 1
    for lvl in LEVELS:
        if new_xp >= lvl["xp_required"]:
            new_level = lvl["level"]
    
    level_up = new_level > profile.get("level", 1)
    
    await db.gamification.update_one(
        {"device_id": device_id},
        {"$set": {"xp": new_xp, "level": new_level}}
    )
    
    return {"new_xp": new_xp, "new_level": new_level, "level_up": level_up, "xp_added": xp}

@api_router.post("/gamification/{device_id}/update-streak")
async def update_streak(device_id: str, all_habits_completed: bool):
    profile = await db.gamification.find_one({"device_id": device_id})
    if not profile:
        new_profile = GamificationProfile(device_id=device_id)
        await db.gamification.insert_one(new_profile.dict())
        profile = new_profile.dict()
    
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    last_checkin = profile.get("last_checkin_date")
    current_streak = profile.get("current_streak", 0)
    longest_streak = profile.get("longest_streak", 0)
    
    if all_habits_completed:
        if last_checkin:
            last_date = last_checkin if isinstance(last_checkin, datetime) else datetime.fromisoformat(str(last_checkin))
            last_date = last_date.replace(hour=0, minute=0, second=0, microsecond=0)
            days_diff = (today - last_date).days
            
            if days_diff == 1:
                current_streak += 1
            elif days_diff > 1:
                current_streak = 1
            # Same day = no change to streak
        else:
            current_streak = 1
        
        longest_streak = max(longest_streak, current_streak)
    else:
        # Streak broken if not all habits completed
        if last_checkin:
            last_date = last_checkin if isinstance(last_checkin, datetime) else datetime.fromisoformat(str(last_checkin))
            last_date = last_date.replace(hour=0, minute=0, second=0, microsecond=0)
            if (today - last_date).days >= 1:
                current_streak = 0
    
    # Check for streak badges
    new_badges = list(profile.get("badges", []))
    if current_streak >= 7 and "streak_master_7" not in new_badges:
        new_badges.append("streak_master_7")
    if current_streak >= 14 and "streak_master_14" not in new_badges:
        new_badges.append("streak_master_14")
    if current_streak >= 30 and "streak_master_30" not in new_badges:
        new_badges.append("streak_master_30")
    
    await db.gamification.update_one(
        {"device_id": device_id},
        {"$set": {
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "last_checkin_date": today,
            "badges": new_badges
        }}
    )
    
    return {
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "new_badges": [b for b in new_badges if b not in profile.get("badges", [])]
    }

@api_router.post("/gamification/{device_id}/award-badge")
async def award_badge(device_id: str, badge_id: str, language: str = "de"):
    if badge_id not in BADGES:
        raise HTTPException(status_code=400, detail="Badge not found" if language == "en" else "Badge nicht gefunden")
    
    await db.gamification.update_one(
        {"device_id": device_id},
        {"$addToSet": {"badges": badge_id}}
    )
    
    return {"badge": get_localized_badge(BADGES[badge_id], language), "awarded": True}

@api_router.get("/challenges")
async def get_available_challenges(language: str = "de"):
    # Return challenges with localized name and description
    localized_challenges = []
    for c in WEEKLY_CHALLENGES:
        localized_challenges.append({
            "id": c["id"],
            "name": c.get(f"name_{language}", c.get("name_de", "")),
            "description": c.get(f"description_{language}", c.get("description_de", "")),
            "target": c["target"],
            "xp_reward": c["xp_reward"],
            "type": c["type"]
        })
    return {"challenges": localized_challenges}

@api_router.post("/gamification/{device_id}/start-challenge")
async def start_challenge(device_id: str, challenge_id: str):
    challenge = next((c for c in WEEKLY_CHALLENGES if c["id"] == challenge_id), None)
    if not challenge:
        raise HTTPException(status_code=400, detail="Challenge nicht gefunden")
    
    await db.gamification.update_one(
        {"device_id": device_id},
        {"$set": {
            "active_challenge": challenge_id,
            "challenge_progress": 0,
            "challenge_start_date": datetime.utcnow()
        }},
        upsert=True
    )
    
    return {"challenge": challenge, "started": True}

@api_router.post("/gamification/{device_id}/update-challenge")
async def update_challenge_progress(device_id: str, progress_increment: int = 1):
    profile = await db.gamification.find_one({"device_id": device_id})
    if not profile or not profile.get("active_challenge"):
        return {"active": False}
    
    challenge = next((c for c in WEEKLY_CHALLENGES if c["id"] == profile["active_challenge"]), None)
    if not challenge:
        return {"active": False}
    
    new_progress = profile.get("challenge_progress", 0) + progress_increment
    completed = new_progress >= challenge["target"]
    
    update_data = {"challenge_progress": new_progress}
    xp_earned = 0
    
    if completed:
        xp_earned = challenge["xp_reward"]
        update_data["active_challenge"] = None
        update_data["challenge_progress"] = 0
        update_data["xp"] = profile.get("xp", 0) + xp_earned
        
        # Award challenger badge if first challenge
        if "challenger" not in profile.get("badges", []):
            update_data["badges"] = profile.get("badges", []) + ["challenger"]
    
    await db.gamification.update_one(
        {"device_id": device_id},
        {"$set": update_data}
    )
    
    return {
        "progress": new_progress,
        "target": challenge["target"],
        "completed": completed,
        "xp_earned": xp_earned
    }

# ==================== JOURNAL ====================

class JournalEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    date: datetime = Field(default_factory=datetime.utcnow)
    note: Optional[str] = None
    reflection_question: Optional[str] = None
    reflection_answer: Optional[str] = None
    gratitudes: List[str] = []
    mood_note: Optional[str] = None

class JournalEntryCreate(BaseModel):
    device_id: str
    note: Optional[str] = None
    reflection_answer: Optional[str] = None
    gratitudes: List[str] = []
    mood_note: Optional[str] = None

REFLECTION_QUESTIONS_DE = [
    "Was war heute dein größter Erfolg?",
    "Wofür bist du heute dankbar?",
    "Was hast du heute gelernt?",
    "Was hättest du heute anders machen können?",
    "Wer hat dir heute geholfen oder dich inspiriert?",
    "Was hat dich heute glücklich gemacht?",
    "Welche Herausforderung hast du heute gemeistert?",
    "Was möchtest du morgen erreichen?",
    "Wie hast du heute für dich selbst gesorgt?",
    "Was war der beste Moment des Tages?"
]

REFLECTION_QUESTIONS_EN = [
    "What was your biggest success today?",
    "What are you grateful for today?",
    "What did you learn today?",
    "What could you have done differently today?",
    "Who helped or inspired you today?",
    "What made you happy today?",
    "What challenge did you overcome today?",
    "What do you want to achieve tomorrow?",
    "How did you take care of yourself today?",
    "What was the best moment of the day?"
]

def get_reflection_question(language: str = "de") -> str:
    import random
    questions = REFLECTION_QUESTIONS_EN if language == "en" else REFLECTION_QUESTIONS_DE
    return random.choice(questions)

@api_router.get("/journal/{device_id}")
async def get_journal_entries(device_id: str, limit: int = 30):
    entries = await db.journal.find(
        {"device_id": device_id}
    ).sort("date", -1).limit(limit).to_list(limit)
    
    return {"entries": serialize_doc(entries)}

@api_router.get("/journal/{device_id}/today")
async def get_today_journal(device_id: str, language: str = "de"):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    entry = await db.journal.find_one({
        "device_id": device_id,
        "date": {"$gte": today_start, "$lt": today_end}
    })
    
    # Get a random reflection question in the correct language
    question = get_reflection_question(language)
    
    return {
        "entry": serialize_doc(entry),
        "reflection_question": question,
        "has_entry": entry is not None
    }

@api_router.post("/journal")
async def create_or_update_journal(input: JournalEntryCreate, language: str = "de"):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    existing = await db.journal.find_one({
        "device_id": input.device_id,
        "date": {"$gte": today_start, "$lt": today_end}
    })
    
    question = get_reflection_question(language)
    
    if existing:
        await db.journal.update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "note": input.note,
                "reflection_answer": input.reflection_answer,
                "gratitudes": input.gratitudes,
                "mood_note": input.mood_note
            }}
        )
        entry = await db.journal.find_one({"_id": existing["_id"]})
    else:
        entry = JournalEntry(
            device_id=input.device_id,
            note=input.note,
            reflection_question=question,
            reflection_answer=input.reflection_answer,
            gratitudes=input.gratitudes,
            mood_note=input.mood_note
        )
        await db.journal.insert_one(entry.dict())
        entry = entry.dict()
    
    # Update gamification - journal writer badge
    profile = await db.gamification.find_one({"device_id": input.device_id})
    if profile:
        journal_count = await db.journal.count_documents({"device_id": input.device_id})
        gratitude_count = await db.journal.aggregate([
            {"$match": {"device_id": input.device_id}},
            {"$project": {"count": {"$size": {"$ifNull": ["$gratitudes", []]}}}},
            {"$group": {"_id": None, "total": {"$sum": "$count"}}}
        ]).to_list(1)
        total_gratitudes = gratitude_count[0]["total"] if gratitude_count else 0
        
        new_badges = list(profile.get("badges", []))
        if journal_count >= 10 and "journal_writer" not in new_badges:
            new_badges.append("journal_writer")
        if total_gratitudes >= 30 and "gratitude_guru" not in new_badges:
            new_badges.append("gratitude_guru")
        
        if new_badges != profile.get("badges", []):
            await db.gamification.update_one(
                {"device_id": input.device_id},
                {"$set": {"badges": new_badges}}
            )
    
    return {"entry": serialize_doc(entry)}

# ==================== SOCIAL / ACCOUNTABILITY ====================

class PartnerInvite(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    inviter_device_id: str
    invite_code: str = Field(default_factory=lambda: str(uuid.uuid4())[:8].upper())
    invitee_device_id: Optional[str] = None
    status: str = "pending"  # pending, accepted, declined
    created_at: datetime = Field(default_factory=datetime.utcnow)

class PartnerConnection(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id_1: str
    device_id_2: str
    connected_at: datetime = Field(default_factory=datetime.utcnow)

@api_router.post("/social/invite")
async def create_partner_invite(device_id: str):
    # Check if user already has a partner
    existing = await db.partner_connections.find_one({
        "$or": [{"device_id_1": device_id}, {"device_id_2": device_id}]
    })
    if existing:
        raise HTTPException(status_code=400, detail="Du hast bereits einen Partner")
    
    # Create invite
    invite = PartnerInvite(inviter_device_id=device_id)
    await db.partner_invites.insert_one(invite.dict())
    
    # Award social butterfly badge
    await db.gamification.update_one(
        {"device_id": device_id},
        {"$addToSet": {"badges": "social_butterfly"}},
        upsert=True
    )
    
    return {"invite_code": invite.invite_code, "invite": serialize_doc(invite.dict())}

@api_router.post("/social/accept-invite")
async def accept_partner_invite(device_id: str, invite_code: str):
    invite = await db.partner_invites.find_one({
        "invite_code": invite_code.upper(),
        "status": "pending"
    })
    
    if not invite:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden oder bereits verwendet")
    
    if invite["inviter_device_id"] == device_id:
        raise HTTPException(status_code=400, detail="Du kannst deine eigene Einladung nicht annehmen")
    
    # Create connection
    connection = PartnerConnection(
        device_id_1=invite["inviter_device_id"],
        device_id_2=device_id
    )
    await db.partner_connections.insert_one(connection.dict())
    
    # Update invite status
    await db.partner_invites.update_one(
        {"_id": invite["_id"]},
        {"$set": {"status": "accepted", "invitee_device_id": device_id}}
    )
    
    return {"connected": True, "partner_device_id": invite["inviter_device_id"]}

@api_router.get("/social/partner/{device_id}")
async def get_partner_info(device_id: str):
    connection = await db.partner_connections.find_one({
        "$or": [{"device_id_1": device_id}, {"device_id_2": device_id}]
    })
    
    if not connection:
        # Check for pending invites
        invite = await db.partner_invites.find_one({
            "inviter_device_id": device_id,
            "status": "pending"
        })
        return {
            "has_partner": False,
            "pending_invite": serialize_doc(invite) if invite else None
        }
    
    partner_id = connection["device_id_2"] if connection["device_id_1"] == device_id else connection["device_id_1"]
    
    # Get partner's gamification profile
    partner_profile = await db.gamification.find_one({"device_id": partner_id})
    
    # Get partner's recent activity (today's check-in)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    partner_checkin = await db.daily_checkins.find_one({
        "device_id": partner_id,
        "date": {"$gte": today_start}
    })
    
    return {
        "has_partner": True,
        "partner": {
            "streak": partner_profile.get("current_streak", 0) if partner_profile else 0,
            "level": partner_profile.get("level", 1) if partner_profile else 1,
            "xp": partner_profile.get("xp", 0) if partner_profile else 0,
            "checked_in_today": partner_checkin is not None,
            "habits_today": partner_checkin.get("habits_completed", "") if partner_checkin else ""
        }
    }

@api_router.delete("/social/partner/{device_id}")
async def remove_partner(device_id: str):
    await db.partner_connections.delete_one({
        "$or": [{"device_id_1": device_id}, {"device_id_2": device_id}]
    })
    return {"removed": True}

# Anonymous Group Comparison
@api_router.get("/social/leaderboard")
async def get_anonymous_leaderboard(device_id: str, language: str = "de"):
    # Get top 20 users by XP
    top_users = await db.gamification.find().sort("xp", -1).limit(20).to_list(20)
    
    # Find user's rank
    user_profile = await db.gamification.find_one({"device_id": device_id})
    user_xp = user_profile.get("xp", 0) if user_profile else 0
    user_rank = await db.gamification.count_documents({"xp": {"$gt": user_xp}}) + 1
    
    # Anonymize leaderboard with localized names
    you_text = "You" if language == "en" else "Du"
    player_text = "Player" if language == "en" else "Spieler"
    
    leaderboard = []
    for i, user in enumerate(top_users):
        is_current_user = user.get("device_id") == device_id
        leaderboard.append({
            "rank": i + 1,
            "name": you_text if is_current_user else f"{player_text} {i + 1}",
            "xp": user.get("xp", 0),
            "level": user.get("level", 1),
            "streak": user.get("current_streak", 0),
            "is_you": is_current_user
        })
    
    return {
        "leaderboard": leaderboard,
        "your_rank": user_rank,
        "total_players": await db.gamification.count_documents({})
    }

# ==================== SMART FEATURES SETTINGS ====================

class SmartFeaturesSettings(BaseModel):
    widget_enabled: bool = False
    watch_enabled: bool = False
    assistant_enabled: bool = False
    assistant_type: str = "none"  # none, siri, google, alexa

@api_router.get("/smart-features/{device_id}")
async def get_smart_features(device_id: str):
    settings = await db.smart_features.find_one({"device_id": device_id})
    if not settings:
        return SmartFeaturesSettings().dict()
    return serialize_doc(settings)

@api_router.post("/smart-features/{device_id}")
async def update_smart_features(device_id: str, settings: SmartFeaturesSettings):
    await db.smart_features.update_one(
        {"device_id": device_id},
        {"$set": {**settings.dict(), "device_id": device_id}},
        upsert=True
    )
    return {"updated": True, "settings": settings.dict()}

# ============================================
# SUBSCRIPTION & PREMIUM ENDPOINTS
# ============================================

# Get subscription status
@api_router.get("/subscription/{device_id}")
async def get_subscription_status(device_id: str):
    """Get the current subscription status for a device"""
    status = await check_premium_status(device_id)
    return status

# Redeem promo code
@api_router.post("/subscription/redeem-promo")
async def redeem_promo_code(request: PromoCodeRedeem):
    """Redeem a promo code for premium access"""
    code_doc = await db.promo_codes.find_one({"code": request.code.upper()})
    
    if not code_doc:
        raise HTTPException(status_code=404, detail="Ungültiger Code. Bitte überprüfe die Eingabe.")
    
    if not code_doc.get("is_active", True):
        raise HTTPException(status_code=400, detail="Dieser Code ist nicht mehr aktiv.")
    
    if code_doc.get("max_uses") and code_doc.get("current_uses", 0) >= code_doc["max_uses"]:
        raise HTTPException(status_code=400, detail="Dieser Code wurde bereits zu oft verwendet.")
    
    # Check if user already has an active subscription
    existing = await db.subscriptions.find_one({"device_id": request.device_id})
    current_expiry = datetime.utcnow()
    
    if existing and existing.get("expires_at"):
        exp = existing["expires_at"]
        if isinstance(exp, str):
            exp = datetime.fromisoformat(exp.replace('Z', '+00:00'))
        if exp > datetime.utcnow():
            # Extend from current expiry
            current_expiry = exp
    
    # Calculate new expiry
    duration_days = code_doc.get("duration_days", 30)
    new_expiry = current_expiry + timedelta(days=duration_days)
    
    # Create/update subscription
    await db.subscriptions.update_one(
        {"device_id": request.device_id},
        {"$set": {
            "device_id": request.device_id,
            "is_premium": True,
            "subscription_type": "promo",
            "promo_code_used": request.code.upper(),
            "expires_at": new_expiry,
            "updated_at": datetime.utcnow()
        }},
        upsert=True
    )
    
    # Increment code usage
    await db.promo_codes.update_one(
        {"code": request.code.upper()},
        {"$inc": {"current_uses": 1}}
    )
    
    # Log redemption
    await db.promo_redemptions.insert_one({
        "device_id": request.device_id,
        "code": request.code.upper(),
        "redeemed_at": datetime.utcnow(),
        "duration_days": duration_days
    })
    
    duration_text = {
        7: "1 Woche",
        30: "1 Monat",
        90: "3 Monate",
        180: "6 Monate",
        365: "1 Jahr"
    }.get(duration_days, f"{duration_days} Tage")
    
    return {
        "success": True,
        "message": f"🎉 Code eingelöst! Du hast jetzt {duration_text} Premium-Zugang.",
        "expires_at": new_expiry.isoformat(),
        "duration_days": duration_days
    }

# ============================================
# STRIPE INTEGRATION (Test Mode)
# ============================================

@api_router.post("/subscription/stripe/create-checkout")
async def create_stripe_checkout(request: StripeCheckoutRequest):
    """Create a Stripe checkout session for subscription"""
    import stripe
    
    stripe_key = os.environ.get('STRIPE_SECRET_KEY')
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Stripe ist noch nicht konfiguriert. Bitte später versuchen.")
    
    stripe.api_key = stripe_key
    
    try:
        # Create Stripe checkout session
        session = stripe.checkout.Session.create(
            mode='subscription',
            payment_method_types=['card', 'sepa_debit'],
            line_items=[{
                'price_data': {
                    'currency': 'eur',
                    'product_data': {
                        'name': 'Schritt für Schritt Premium',
                        'description': 'KI-Coaching & Wochenanalysen',
                    },
                    'unit_amount': 499,  # 4.99 EUR in cents
                    'recurring': {
                        'interval': 'month',
                    },
                },
                'quantity': 1,
            }],
            success_url=request.success_url + '?session_id={CHECKOUT_SESSION_ID}',
            cancel_url=request.cancel_url,
            metadata={
                'device_id': request.device_id
            }
        )
        
        return {
            "checkout_url": session.url,
            "session_id": session.id
        }
    except Exception as e:
        logger.error(f"Stripe checkout error: {e}")
        raise HTTPException(status_code=500, detail="Fehler beim Erstellen der Zahlung.")

@api_router.post("/subscription/stripe/webhook")
async def stripe_webhook(request: dict):
    """Handle Stripe webhooks"""
    import stripe
    
    stripe_key = os.environ.get('STRIPE_SECRET_KEY')
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Stripe nicht konfiguriert")
    
    stripe.api_key = stripe_key
    
    event_type = request.get('type')
    data = request.get('data', {}).get('object', {})
    
    if event_type == 'checkout.session.completed':
        device_id = data.get('metadata', {}).get('device_id')
        subscription_id = data.get('subscription')
        
        if device_id:
            # Get subscription details
            sub = stripe.Subscription.retrieve(subscription_id)
            current_period_end = datetime.fromtimestamp(sub.current_period_end)
            
            await db.subscriptions.update_one(
                {"device_id": device_id},
                {"$set": {
                    "device_id": device_id,
                    "is_premium": True,
                    "subscription_type": "stripe",
                    "subscription_id": subscription_id,
                    "stripe_customer_id": data.get('customer'),
                    "expires_at": current_period_end,
                    "updated_at": datetime.utcnow()
                }},
                upsert=True
            )
    
    elif event_type == 'customer.subscription.updated':
        subscription_id = data.get('id')
        current_period_end = datetime.fromtimestamp(data.get('current_period_end', 0))
        status = data.get('status')
        
        await db.subscriptions.update_one(
            {"subscription_id": subscription_id},
            {"$set": {
                "expires_at": current_period_end,
                "stripe_status": status,
                "is_premium": status == 'active',
                "updated_at": datetime.utcnow()
            }}
        )
    
    elif event_type == 'customer.subscription.deleted':
        subscription_id = data.get('id')
        
        await db.subscriptions.update_one(
            {"subscription_id": subscription_id},
            {"$set": {
                "is_premium": False,
                "stripe_status": "canceled",
                "updated_at": datetime.utcnow()
            }}
        )
    
    return {"received": True}

# ============================================
# PAYPAL INTEGRATION
# ============================================

@api_router.post("/subscription/paypal/create-order")
async def create_paypal_order(request: PayPalCheckoutRequest):
    """Create a PayPal subscription order"""
    import httpx
    
    client_id = os.environ.get('PAYPAL_CLIENT_ID')
    client_secret = os.environ.get('PAYPAL_CLIENT_SECRET')
    
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="PayPal ist noch nicht konfiguriert.")
    
    # Use sandbox for testing
    paypal_base = os.environ.get('PAYPAL_BASE_URL', 'https://api-m.sandbox.paypal.com')
    
    try:
        async with httpx.AsyncClient() as client:
            # Get access token
            auth_response = await client.post(
                f"{paypal_base}/v1/oauth2/token",
                auth=(client_id, client_secret),
                data={"grant_type": "client_credentials"}
            )
            access_token = auth_response.json().get('access_token')
            
            # Create subscription
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            plan_id = os.environ.get('PAYPAL_PLAN_ID')
            
            if plan_id:
                # Use existing plan
                subscription_data = {
                    "plan_id": plan_id,
                    "application_context": {
                        "return_url": request.return_url,
                        "cancel_url": request.cancel_url,
                        "brand_name": "Schritt für Schritt",
                        "user_action": "SUBSCRIBE_NOW"
                    },
                    "custom_id": request.device_id
                }
                
                response = await client.post(
                    f"{paypal_base}/v1/billing/subscriptions",
                    headers=headers,
                    json=subscription_data
                )
            else:
                # Create order for one-time monthly payment
                order_data = {
                    "intent": "CAPTURE",
                    "purchase_units": [{
                        "amount": {
                            "currency_code": "EUR",
                            "value": "4.99"
                        },
                        "description": "Schritt für Schritt Premium (1 Monat)",
                        "custom_id": request.device_id
                    }],
                    "application_context": {
                        "return_url": request.return_url,
                        "cancel_url": request.cancel_url,
                        "brand_name": "Schritt für Schritt"
                    }
                }
                
                response = await client.post(
                    f"{paypal_base}/v2/checkout/orders",
                    headers=headers,
                    json=order_data
                )
            
            result = response.json()
            
            # Find approval URL
            approval_url = None
            for link in result.get('links', []):
                if link.get('rel') == 'approve':
                    approval_url = link.get('href')
                    break
            
            return {
                "order_id": result.get('id'),
                "approval_url": approval_url
            }
            
    except Exception as e:
        logger.error(f"PayPal error: {e}")
        raise HTTPException(status_code=500, detail="Fehler bei PayPal-Verbindung.")

@api_router.post("/subscription/paypal/capture")
async def capture_paypal_order(order_id: str, device_id: str):
    """Capture a PayPal order after approval"""
    import httpx
    
    client_id = os.environ.get('PAYPAL_CLIENT_ID')
    client_secret = os.environ.get('PAYPAL_CLIENT_SECRET')
    paypal_base = os.environ.get('PAYPAL_BASE_URL', 'https://api-m.sandbox.paypal.com')
    
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="PayPal nicht konfiguriert")
    
    try:
        async with httpx.AsyncClient() as client:
            # Get access token
            auth_response = await client.post(
                f"{paypal_base}/v1/oauth2/token",
                auth=(client_id, client_secret),
                data={"grant_type": "client_credentials"}
            )
            access_token = auth_response.json().get('access_token')
            
            # Capture the order
            headers = {"Authorization": f"Bearer {access_token}"}
            response = await client.post(
                f"{paypal_base}/v2/checkout/orders/{order_id}/capture",
                headers=headers
            )
            
            result = response.json()
            
            if result.get('status') == 'COMPLETED':
                # Grant premium access for 1 month
                expires_at = datetime.utcnow() + timedelta(days=30)
                
                await db.subscriptions.update_one(
                    {"device_id": device_id},
                    {"$set": {
                        "device_id": device_id,
                        "is_premium": True,
                        "subscription_type": "paypal",
                        "paypal_order_id": order_id,
                        "expires_at": expires_at,
                        "updated_at": datetime.utcnow()
                    }},
                    upsert=True
                )
                
                return {
                    "success": True,
                    "message": "Zahlung erfolgreich! Premium aktiviert.",
                    "expires_at": expires_at.isoformat()
                }
            else:
                raise HTTPException(status_code=400, detail="Zahlung konnte nicht abgeschlossen werden.")
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PayPal capture error: {e}")
        raise HTTPException(status_code=500, detail="Fehler beim Abschließen der Zahlung.")

# ============================================
# REVENUECAT INTEGRATION (for Native Apps)
# ============================================

@api_router.post("/subscription/revenuecat/webhook")
async def revenuecat_webhook(request: dict):
    """Handle RevenueCat webhooks for iOS/Android subscriptions"""
    event = request.get('event', {})
    event_type = event.get('type')
    
    app_user_id = event.get('app_user_id')  # This should be the device_id
    
    if not app_user_id:
        return {"received": True, "processed": False}
    
    if event_type in ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE']:
        # User subscribed or renewed
        expiration_at = event.get('expiration_at_ms')
        if expiration_at:
            expires_at = datetime.fromtimestamp(expiration_at / 1000)
        else:
            expires_at = datetime.utcnow() + timedelta(days=30)
        
        await db.subscriptions.update_one(
            {"device_id": app_user_id},
            {"$set": {
                "device_id": app_user_id,
                "is_premium": True,
                "subscription_type": "revenuecat",
                "revenuecat_event": event_type,
                "expires_at": expires_at,
                "updated_at": datetime.utcnow()
            }},
            upsert=True
        )
    
    elif event_type in ['CANCELLATION', 'EXPIRATION']:
        # Subscription ended
        await db.subscriptions.update_one(
            {"device_id": app_user_id},
            {"$set": {
                "is_premium": False,
                "revenuecat_event": event_type,
                "updated_at": datetime.utcnow()
            }}
        )
    
    return {"received": True, "processed": True}

# ============================================
# ADMIN ENDPOINTS FOR PROMO CODES
# ============================================

@api_router.post("/admin/promo-codes")
async def create_promo_code(code_data: PromoCodeCreate, admin_password: str):
    """Create a new promo code (Admin only)"""
    if not verify_admin(admin_password):
        raise HTTPException(status_code=403, detail="Ungültiges Admin-Passwort")
    
    # Check if code already exists
    existing = await db.promo_codes.find_one({"code": code_data.code.upper()})
    if existing:
        raise HTTPException(status_code=400, detail="Dieser Code existiert bereits.")
    
    promo = PromoCode(
        code=code_data.code.upper(),
        duration_days=code_data.duration_days,
        description=code_data.description,
        max_uses=code_data.max_uses
    )
    
    await db.promo_codes.insert_one(promo.dict())
    
    duration_text = {
        7: "1 Woche",
        30: "1 Monat",
        90: "3 Monate",
        180: "6 Monate",
        365: "1 Jahr"
    }.get(code_data.duration_days, f"{code_data.duration_days} Tage")
    
    return {
        "success": True,
        "code": promo.code,
        "duration": duration_text,
        "max_uses": promo.max_uses or "Unbegrenzt"
    }

@api_router.get("/admin/promo-codes")
async def list_promo_codes(admin_password: str):
    """List all promo codes (Admin only)"""
    if not verify_admin(admin_password):
        raise HTTPException(status_code=403, detail="Ungültiges Admin-Passwort")
    
    codes = await db.promo_codes.find().to_list(100)
    return {"codes": serialize_doc(codes)}

@api_router.put("/admin/promo-codes/{code}")
async def update_promo_code(code: str, admin_password: str, is_active: bool = None, max_uses: int = None):
    """Update a promo code (Admin only)"""
    if not verify_admin(admin_password):
        raise HTTPException(status_code=403, detail="Ungültiges Admin-Passwort")
    
    update_data = {}
    if is_active is not None:
        update_data["is_active"] = is_active
    if max_uses is not None:
        update_data["max_uses"] = max_uses
    
    if not update_data:
        raise HTTPException(status_code=400, detail="Keine Änderungen angegeben")
    
    result = await db.promo_codes.update_one(
        {"code": code.upper()},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Code nicht gefunden")
    
    return {"success": True, "updated": update_data}

@api_router.delete("/admin/promo-codes/{code}")
async def delete_promo_code(code: str, admin_password: str):
    """Delete a promo code (Admin only)"""
    if not verify_admin(admin_password):
        raise HTTPException(status_code=403, detail="Ungültiges Admin-Passwort")
    
    result = await db.promo_codes.delete_one({"code": code.upper()})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Code nicht gefunden")
    
    return {"success": True, "deleted": code.upper()}

@api_router.get("/admin/subscriptions")
async def list_subscriptions(admin_password: str, skip: int = 0, limit: int = 50):
    """List all subscriptions (Admin only)"""
    if not verify_admin(admin_password):
        raise HTTPException(status_code=403, detail="Ungültiges Admin-Passwort")
    
    subscriptions = await db.subscriptions.find().skip(skip).limit(limit).to_list(limit)
    total = await db.subscriptions.count_documents({})
    
    return {
        "subscriptions": serialize_doc(subscriptions),
        "total": total,
        "skip": skip,
        "limit": limit
    }

# ============================================
# BACKUP & SYNC (Premium Feature)
# ============================================

class BackupData(BaseModel):
    device_id: str
    goals: Optional[list] = None
    checkins: Optional[list] = None
    settings: Optional[dict] = None
    profile: Optional[dict] = None
    journal: Optional[list] = None

@api_router.post("/backup/create/{device_id}")
async def create_backup(device_id: str):
    """Create a full backup of user data (Premium Feature)"""
    premium_status = await check_premium_status(device_id)
    if not premium_status.get("is_premium"):
        raise HTTPException(
            status_code=403, 
            detail="Cloud-Backup ist nur für Premium-Nutzer verfügbar."
        )
    
    # Collect all user data
    goals = await db.goals.find({"device_id": device_id}).to_list(100)
    checkins = await db.daily_checkins.find({"device_id": device_id}).to_list(1000)
    settings = await db.settings.find_one({"device_id": device_id})
    profile = await db.profiles.find_one({"device_id": device_id})
    journal = await db.journal.find({"device_id": device_id}).to_list(500)
    
    backup_data = {
        "device_id": device_id,
        "created_at": datetime.utcnow().isoformat(),
        "version": "1.0",
        "goals": serialize_doc(goals),
        "checkins": serialize_doc(checkins),
        "settings": serialize_doc(settings) if settings else None,
        "profile": serialize_doc(profile) if profile else None,
        "journal": serialize_doc(journal),
    }
    
    # Store backup
    await db.backups.update_one(
        {"device_id": device_id},
        {"$set": backup_data},
        upsert=True
    )
    
    return {
        "success": True,
        "message": "Backup erfolgreich erstellt!",
        "backup_date": backup_data["created_at"],
        "stats": {
            "goals": len(goals),
            "checkins": len(checkins),
            "journal_entries": len(journal)
        }
    }

@api_router.get("/backup/{device_id}")
async def get_backup(device_id: str):
    """Get the latest backup (Premium Feature)"""
    premium_status = await check_premium_status(device_id)
    if not premium_status.get("is_premium"):
        raise HTTPException(status_code=403, detail="Cloud-Backup ist nur für Premium-Nutzer verfügbar.")
    
    backup = await db.backups.find_one({"device_id": device_id})
    if not backup:
        return {"has_backup": False}
    
    return {
        "has_backup": True,
        "backup_date": backup.get("created_at"),
        "stats": {
            "goals": len(backup.get("goals", [])),
            "checkins": len(backup.get("checkins", [])),
            "journal_entries": len(backup.get("journal", []))
        }
    }

@api_router.post("/backup/restore/{device_id}")
async def restore_backup(device_id: str, target_device_id: Optional[str] = None):
    """Restore from backup (Premium Feature) - can restore to same or different device"""
    premium_status = await check_premium_status(device_id)
    if not premium_status.get("is_premium"):
        raise HTTPException(status_code=403, detail="Cloud-Backup ist nur für Premium-Nutzer verfügbar.")
    
    backup = await db.backups.find_one({"device_id": device_id})
    if not backup:
        raise HTTPException(status_code=404, detail="Kein Backup gefunden.")
    
    restore_to = target_device_id or device_id
    
    # Restore goals
    if backup.get("goals"):
        for goal in backup["goals"]:
            goal["device_id"] = restore_to
            goal.pop("_id", None)
        await db.goals.delete_many({"device_id": restore_to})
        if backup["goals"]:
            await db.goals.insert_many(backup["goals"])
    
    # Restore checkins
    if backup.get("checkins"):
        for checkin in backup["checkins"]:
            checkin["device_id"] = restore_to
            checkin.pop("_id", None)
        await db.daily_checkins.delete_many({"device_id": restore_to})
        if backup["checkins"]:
            await db.daily_checkins.insert_many(backup["checkins"])
    
    # Restore settings
    if backup.get("settings"):
        settings = backup["settings"]
        settings["device_id"] = restore_to
        settings.pop("_id", None)
        await db.settings.update_one(
            {"device_id": restore_to},
            {"$set": settings},
            upsert=True
        )
    
    # Restore profile
    if backup.get("profile"):
        profile = backup["profile"]
        profile["device_id"] = restore_to
        profile.pop("_id", None)
        await db.profiles.update_one(
            {"device_id": restore_to},
            {"$set": profile},
            upsert=True
        )
    
    # Restore journal
    if backup.get("journal"):
        for entry in backup["journal"]:
            entry["device_id"] = restore_to
            entry.pop("_id", None)
        await db.journal.delete_many({"device_id": restore_to})
        if backup["journal"]:
            await db.journal.insert_many(backup["journal"])
    
    return {
        "success": True,
        "message": "Backup erfolgreich wiederhergestellt!",
        "restored_to": restore_to
    }

# ============================================
# DETAILED STATISTICS (Premium Feature)
# ============================================

@api_router.get("/stats/detailed/{device_id}")
async def get_detailed_stats(device_id: str, period: str = "month"):
    """Get detailed statistics (Premium Feature)"""
    premium_status = await check_premium_status(device_id)
    if not premium_status.get("is_premium"):
        raise HTTPException(
            status_code=403, 
            detail="Detaillierte Statistiken sind nur für Premium-Nutzer verfügbar."
        )
    
    # Determine date range
    now = datetime.utcnow()
    if period == "week":
        start_date = now - timedelta(days=7)
    elif period == "month":
        start_date = now - timedelta(days=30)
    elif period == "quarter":
        start_date = now - timedelta(days=90)
    elif period == "year":
        start_date = now - timedelta(days=365)
    else:
        start_date = now - timedelta(days=30)
    
    # Get all checkins in period
    checkins = await db.daily_checkins.find({
        "device_id": device_id,
        "date": {"$gte": start_date.strftime("%Y-%m-%d")}
    }).to_list(400)
    
    if not checkins:
        return {
            "period": period,
            "total_days": 0,
            "habit_completion": [],
            "mood_trend": [],
            "best_day": None,
            "worst_day": None,
            "average_mood": 0,
            "total_habits_completed": 0
        }
    
    # Calculate habit completion by day
    daily_stats = {}
    for checkin in checkins:
        date = checkin.get("date")
        results = checkin.get("results", "")
        mood = checkin.get("mood", 5)
        
        completed = sum(1 for c in results if c == "1")
        total = len(results) if results else 3
        
        daily_stats[date] = {
            "date": date,
            "completed": completed,
            "total": total,
            "rate": round(completed / total * 100, 1) if total > 0 else 0,
            "mood": mood
        }
    
    # Sort by date
    sorted_stats = sorted(daily_stats.values(), key=lambda x: x["date"])
    
    # Find best and worst days
    best_day = max(sorted_stats, key=lambda x: (x["rate"], x["mood"]))
    worst_day = min(sorted_stats, key=lambda x: (x["rate"], x["mood"]))
    
    # Calculate averages
    avg_mood = sum(s["mood"] for s in sorted_stats) / len(sorted_stats)
    total_completed = sum(s["completed"] for s in sorted_stats)
    
    return {
        "period": period,
        "total_days": len(sorted_stats),
        "daily_stats": sorted_stats,
        "best_day": best_day,
        "worst_day": worst_day,
        "average_mood": round(avg_mood, 1),
        "total_habits_completed": total_completed,
        "completion_rate": round(sum(s["rate"] for s in sorted_stats) / len(sorted_stats), 1)
    }

# ============================================
# MOOD CORRELATION (Premium Feature)
# ============================================

@api_router.get("/stats/mood-correlation/{device_id}")
async def get_mood_correlation(device_id: str):
    """Analyze mood patterns and correlations (Premium Feature)"""
    premium_status = await check_premium_status(device_id)
    if not premium_status.get("is_premium"):
        raise HTTPException(
            status_code=403, 
            detail="Stimmungs-Analyse ist nur für Premium-Nutzer verfügbar."
        )
    
    # Get last 90 days of data
    start_date = datetime.utcnow() - timedelta(days=90)
    
    checkins = await db.daily_checkins.find({
        "device_id": device_id,
        "date": {"$gte": start_date.strftime("%Y-%m-%d")}
    }).to_list(100)
    
    if len(checkins) < 7:
        return {
            "has_enough_data": False,
            "message": "Mindestens 7 Tage Daten nötig für die Analyse.",
            "current_days": len(checkins)
        }
    
    # Analyze by weekday
    weekday_moods = {i: [] for i in range(7)}
    weekday_names = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
    
    for checkin in checkins:
        date_str = checkin.get("date")
        mood = checkin.get("mood", 5)
        
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            weekday = date_obj.weekday()
            weekday_moods[weekday].append(mood)
        except:
            pass
    
    weekday_analysis = []
    for i in range(7):
        moods = weekday_moods[i]
        if moods:
            avg = sum(moods) / len(moods)
            weekday_analysis.append({
                "weekday": weekday_names[i],
                "weekday_index": i,
                "average_mood": round(avg, 1),
                "sample_size": len(moods)
            })
    
    # Find best and worst days
    if weekday_analysis:
        best_weekday = max(weekday_analysis, key=lambda x: x["average_mood"])
        worst_weekday = min(weekday_analysis, key=lambda x: x["average_mood"])
    else:
        best_weekday = worst_weekday = None
    
    # Correlation: mood vs habit completion
    high_completion_moods = []
    low_completion_moods = []
    
    for checkin in checkins:
        results = checkin.get("results", "")
        mood = checkin.get("mood", 5)
        completed = sum(1 for c in results if c == "1")
        total = len(results) if results else 3
        rate = completed / total if total > 0 else 0
        
        if rate >= 0.67:  # 2/3 or more completed
            high_completion_moods.append(mood)
        elif rate <= 0.33:  # 1/3 or less completed
            low_completion_moods.append(mood)
    
    correlation_insight = None
    if high_completion_moods and low_completion_moods:
        high_avg = sum(high_completion_moods) / len(high_completion_moods)
        low_avg = sum(low_completion_moods) / len(low_completion_moods)
        
        if high_avg > low_avg + 1:
            correlation_insight = f"Wenn du deine Gewohnheiten schaffst, bist du im Schnitt {round(high_avg - low_avg, 1)} Punkte besser gelaunt! 🎯"
        elif high_avg < low_avg:
            correlation_insight = "Interessant: Deine Stimmung scheint unabhängig von den erledigten Gewohnheiten zu sein."
    
    return {
        "has_enough_data": True,
        "total_days_analyzed": len(checkins),
        "weekday_analysis": weekday_analysis,
        "best_weekday": best_weekday,
        "worst_weekday": worst_weekday,
        "correlation_insight": correlation_insight,
        "high_completion_avg_mood": round(sum(high_completion_moods) / len(high_completion_moods), 1) if high_completion_moods else None,
        "low_completion_avg_mood": round(sum(low_completion_moods) / len(low_completion_moods), 1) if low_completion_moods else None
    }

# ============================================
# EXPORT (Premium Feature)
# ============================================

@api_router.get("/export/{device_id}")
async def export_data(device_id: str, format: str = "json"):
    """Export user data as JSON or CSV (Premium Feature)"""
    premium_status = await check_premium_status(device_id)
    if not premium_status.get("is_premium"):
        raise HTTPException(
            status_code=403, 
            detail="Daten-Export ist nur für Premium-Nutzer verfügbar."
        )
    
    # Get all data
    goals_doc = await db.goals.find_one({"device_id": device_id})
    checkins = await db.daily_checkins.find({"device_id": device_id}).sort("date", -1).to_list(1000)
    
    goals = goals_doc.get("goals", []) if goals_doc else []
    
    if format == "csv":
        # Create CSV format
        csv_lines = ["Datum,Gewohnheit 1,Gewohnheit 2,Gewohnheit 3,Stimmung"]
        
        for checkin in checkins:
            date = checkin.get("date", "")
            results = checkin.get("results", "000")
            mood = checkin.get("mood", "")
            
            h1 = "Ja" if len(results) > 0 and results[0] == "1" else "Nein"
            h2 = "Ja" if len(results) > 1 and results[1] == "1" else "Nein"
            h3 = "Ja" if len(results) > 2 and results[2] == "1" else "Nein"
            
            csv_lines.append(f"{date},{h1},{h2},{h3},{mood}")
        
        return {
            "format": "csv",
            "data": "\n".join(csv_lines),
            "filename": f"habits_export_{device_id[:8]}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
        }
    else:
        # JSON format
        return {
            "format": "json",
            "data": {
                "export_date": datetime.utcnow().isoformat(),
                "goals": goals,
                "checkins": serialize_doc(checkins)
            },
            "filename": f"habits_export_{device_id[:8]}_{datetime.utcnow().strftime('%Y%m%d')}.json"
        }

# ============================================
# PREMIUM FEATURE CHECK ENDPOINT
# ============================================

@api_router.get("/features/{device_id}")
async def get_available_features(device_id: str):
    """Get all available features for this device based on subscription"""
    status = await check_premium_status(device_id)
    
    return {
        "is_premium": status.get("is_premium", False),
        "subscription_type": status.get("subscription_type"),
        "expires_at": status.get("expires_at"),
        "features": status.get("features", FREE_FEATURES),
        "premium_features_locked": list(PREMIUM_FEATURES.keys()) if not status.get("is_premium") else []
    }

# ============================================
# RATE LIMITING & SECURITY
# ============================================

# Simple in-memory rate limiter (in production, use Redis)
from collections import defaultdict
import time

request_counts = defaultdict(list)
RATE_LIMIT = 100  # requests per minute
RATE_WINDOW = 60  # seconds

def check_rate_limit(device_id: str) -> bool:
    """Check if request should be rate limited"""
    now = time.time()
    window_start = now - RATE_WINDOW
    
    # Clean old requests
    request_counts[device_id] = [t for t in request_counts[device_id] if t > window_start]
    
    if len(request_counts[device_id]) >= RATE_LIMIT:
        return False  # Rate limited
    
    request_counts[device_id].append(now)
    return True

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
