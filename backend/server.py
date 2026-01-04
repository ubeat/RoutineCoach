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

class GoalAdviceRequest(BaseModel):
    device_id: str

# Helper function to get week start (Monday)
def get_week_start(dt: datetime = None) -> datetime:
    if dt is None:
        dt = datetime.utcnow()
    days_since_monday = dt.weekday()
    week_start = dt - timedelta(days=days_since_monday)
    return week_start.replace(hour=0, minute=0, second=0, microsecond=0)

# AI Coach function
async def get_ai_coach_response(request: AICoachRequest) -> str:
    try:
        api_key = os.environ.get('EMERGENT_LLM_KEY')
        if not api_key:
            return "Toll gemacht! Weiter so mit deinen Gewohnheiten! 💪"
        
        # Parse habits completed
        completed = [c == 'y' for c in request.habits_completed.lower()]
        completed_count = sum(completed)
        total_habits = len(completed)
        
        # Build context
        goals_text = "\n".join([f"{i+1}. {g}" for i, g in enumerate(request.goals)])
        completed_text = "\n".join([
            f"- {request.goals[i]}: {'✅ Erledigt' if completed[i] else '❌ Nicht erledigt'}" 
            for i in range(min(len(completed), len(request.goals)))
        ])
        
        week_days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
        day_name = week_days[request.day_of_week]
        
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
        
        user_prompt = f"""Heute ist {day_name}. 

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
        # Fallback responses in German
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
    
    week_start = get_week_start()
    
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
    week_start = get_week_start()
    goals = await db.weekly_goals.find_one({
        "device_id": device_id,
        "week_start": week_start
    })
    
    if not goals:
        return {"goals": None, "message": "Keine Ziele für diese Woche gesetzt"}
    
    return {
        "goals": goals["goals"],
        "id": goals["id"],
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
        week_progress=week_progress
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
