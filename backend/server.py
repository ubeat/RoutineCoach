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
    """Generiert einen ehrlichen, aufbauenden Wochen-Auswertungstext"""
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
    """Führt einen lösungsorientierten Coaching-Dialog"""
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
    """Startet eine neue Coaching-Reflexionssitzung mit einer ersten Frage"""
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
        "name": "Erster Schritt",
        "description": "Dein erster Check-In!",
        "icon": "footsteps",
        "color": "#4ECDC4"
    },
    "week_warrior": {
        "id": "week_warrior",
        "name": "Wochen-Krieger",
        "description": "7 Tage am Stueck eingecheckt",
        "icon": "shield",
        "color": "#FF6B6B"
    },
    "perfect_week": {
        "id": "perfect_week",
        "name": "Perfekte Woche",
        "description": "Alle Habits eine Woche lang erledigt",
        "icon": "trophy",
        "color": "#FFE66D"
    },
    "morning_person": {
        "id": "morning_person",
        "name": "Fruehaufsteher",
        "description": "10x vor 8 Uhr eingecheckt",
        "icon": "sunny",
        "color": "#FFA500"
    },
    "streak_master_7": {
        "id": "streak_master_7",
        "name": "Streak-Meister",
        "description": "7-Tage-Streak erreicht",
        "icon": "flame",
        "color": "#FF4500"
    },
    "streak_master_14": {
        "id": "streak_master_14",
        "name": "Streak-Legende",
        "description": "14-Tage-Streak erreicht",
        "icon": "flame",
        "color": "#FF6347"
    },
    "streak_master_30": {
        "id": "streak_master_30",
        "name": "Streak-Gott",
        "description": "30-Tage-Streak erreicht",
        "icon": "flame",
        "color": "#DC143C"
    },
    "habit_hero": {
        "id": "habit_hero",
        "name": "Habit-Held",
        "description": "50 Habits insgesamt erledigt",
        "icon": "star",
        "color": "#A78BFA"
    },
    "journal_writer": {
        "id": "journal_writer",
        "name": "Tagebuch-Schreiber",
        "description": "10 Journal-Eintraege geschrieben",
        "icon": "book",
        "color": "#F472B6"
    },
    "gratitude_guru": {
        "id": "gratitude_guru",
        "name": "Dankbarkeits-Guru",
        "description": "30 Dankbarkeiten aufgeschrieben",
        "icon": "heart",
        "color": "#EC4899"
    },
    "social_butterfly": {
        "id": "social_butterfly",
        "name": "Sozialer Schmetterling",
        "description": "Einen Partner eingeladen",
        "icon": "people",
        "color": "#06B6D4"
    },
    "challenger": {
        "id": "challenger",
        "name": "Herausforderer",
        "description": "Erste Wochen-Challenge abgeschlossen",
        "icon": "flag",
        "color": "#8B5CF6"
    }
}

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
        "name": "Fruehaufsteher-Challenge",
        "description": "Check 5x vor 7:00 Uhr ein",
        "target": 5,
        "xp_reward": 50,
        "type": "early_checkin"
    },
    {
        "id": "perfect_3",
        "name": "Perfekte 3 Tage",
        "description": "Erledige alle Habits an 3 aufeinanderfolgenden Tagen",
        "target": 3,
        "xp_reward": 75,
        "type": "perfect_days"
    },
    {
        "id": "mood_tracker",
        "name": "Stimmungs-Tracker",
        "description": "Tracke deine Stimmung 7 Tage lang",
        "target": 7,
        "xp_reward": 40,
        "type": "mood_tracking"
    },
    {
        "id": "journal_week",
        "name": "Reflexions-Woche",
        "description": "Schreibe 5 Journal-Eintraege",
        "target": 5,
        "xp_reward": 60,
        "type": "journal_entries"
    },
    {
        "id": "gratitude_master",
        "name": "Dankbarkeits-Meister",
        "description": "Schreibe 10 Dankbarkeiten auf",
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
async def get_gamification_profile(device_id: str):
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
    
    return {
        "profile": serialize_doc(profile),
        "current_level": current_level,
        "next_level": next_level,
        "badges_earned": [BADGES[b] for b in profile.get("badges", []) if b in BADGES],
        "all_badges": list(BADGES.values()),
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
async def award_badge(device_id: str, badge_id: str):
    if badge_id not in BADGES:
        raise HTTPException(status_code=400, detail="Badge nicht gefunden")
    
    await db.gamification.update_one(
        {"device_id": device_id},
        {"$addToSet": {"badges": badge_id}}
    )
    
    return {"badge": BADGES[badge_id], "awarded": True}

@api_router.get("/challenges")
async def get_available_challenges():
    return {"challenges": WEEKLY_CHALLENGES}

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

REFLECTION_QUESTIONS = [
    "Was war heute dein groesster Erfolg?",
    "Wofuer bist du heute dankbar?",
    "Was hast du heute gelernt?",
    "Was haettest du heute anders machen koennen?",
    "Wer hat dir heute geholfen oder dich inspiriert?",
    "Was hat dich heute gluecklich gemacht?",
    "Welche Herausforderung hast du heute gemeistert?",
    "Was moechtest du morgen erreichen?",
    "Wie hast du heute fuer dich selbst gesorgt?",
    "Was war der beste Moment des Tages?"
]

@api_router.get("/journal/{device_id}")
async def get_journal_entries(device_id: str, limit: int = 30):
    entries = await db.journal.find(
        {"device_id": device_id}
    ).sort("date", -1).limit(limit).to_list(limit)
    
    return {"entries": serialize_doc(entries)}

@api_router.get("/journal/{device_id}/today")
async def get_today_journal(device_id: str):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    entry = await db.journal.find_one({
        "device_id": device_id,
        "date": {"$gte": today_start, "$lt": today_end}
    })
    
    # Get a random reflection question
    import random
    question = random.choice(REFLECTION_QUESTIONS)
    
    return {
        "entry": serialize_doc(entry),
        "reflection_question": question,
        "has_entry": entry is not None
    }

@api_router.post("/journal")
async def create_or_update_journal(input: JournalEntryCreate):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    existing = await db.journal.find_one({
        "device_id": input.device_id,
        "date": {"$gte": today_start, "$lt": today_end}
    })
    
    import random
    question = random.choice(REFLECTION_QUESTIONS)
    
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
async def get_anonymous_leaderboard(device_id: str):
    # Get top 20 users by XP
    top_users = await db.gamification.find().sort("xp", -1).limit(20).to_list(20)
    
    # Find user's rank
    user_profile = await db.gamification.find_one({"device_id": device_id})
    user_xp = user_profile.get("xp", 0) if user_profile else 0
    user_rank = await db.gamification.count_documents({"xp": {"$gt": user_xp}}) + 1
    
    # Anonymize leaderboard
    leaderboard = []
    for i, user in enumerate(top_users):
        is_current_user = user.get("device_id") == device_id
        leaderboard.append({
            "rank": i + 1,
            "name": "Du" if is_current_user else f"Spieler {i + 1}",
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
