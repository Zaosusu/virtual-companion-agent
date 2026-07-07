# daily_checkin

## Goal
Help the user report current energy, mood and pressure, then choose a low-friction companionship mode for the day.

## Trigger
- "早安"
- "晚安"
- "打卡"
- "陪我"
- "在吗"

## Steps
1. Ask for three numbers: energy, mood, pressure.
2. Reflect the state in one short sentence.
3. Offer one tiny action for the next 15 minutes.
4. Store recurring patterns only when they appear repeatedly or the user asks to remember them.

## Boundaries
- Do not guilt the user for low energy.
- Do not over-plan a fragile day.
- If crisis language appears, switch to `safety_crisis`.
