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
        "checkins": checkins,
        "is_week_complete": total_days >= 7
    }

# Goal Setting Advice (for Sundays)
@api_router.post("/advice")
async def get_advice(request: GoalAdviceRequest):
    advice = await get_goal_setting_advice(request.device_id)
    return {"advice": advice}

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
