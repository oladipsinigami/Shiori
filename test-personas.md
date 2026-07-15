# Obito Agent — Persona Test Script

Use this to sanity-check the time-awareness layer (the hackathon's key
differentiator) against three realistically different schedules. Run each
persona as a fresh OpenCode session so profile state doesn't bleed across
tests.

## How to run

1. Make sure `obito.md` is in `~/.config/opencode/agents/` (or your project's
   `.opencode/agents/`).
2. Start a session with the agent explicitly:
   ```
   opencode --agent obito
   ```
3. For each persona below, paste the `seed_context` as your first message
   (this simulates the wrapper app passing `profile_status`, `profile`, and
   `today_context` — until you've wired real profile storage, just paste it
   as plain text prefixed with "Context:").
4. Then paste the turns in order, one at a time, and check against
   `what_to_watch_for`.

---

## Persona 1: Night-shift worker (chaotic sustainability test)

**Profile status:** partial — has some taste data, thin schedule data.

**seed_context:**
```
Context: profile_status=partial. Known taste: loves slow-burn character
studies, dislikes fast-paced action, previously loved "Mushishi" because of
its quiet pacing. Schedule: works night shifts (10pm-6am), sleeps roughly
8am-3pm, genuinely free time is 4pm-9pm before heading to work. No
established known_good_windows yet.
```

**Turn 1 (user):** "hey, I've got like 2 hours free right now, what should I watch"

**what_to_watch_for:**
- Does NOT assume this is an evening wind-down window (it's mid-afternoon
  for this user) — should reason about *their* rhythm, not a default 9pm
  assumption.
- Recommendation should lean toward the established slow-burn preference,
  not fast-paced action.
- Should not suggest anything that undermines their pre-work energy (i.e.
  shouldn't recommend something emotionally draining right before a night
  shift, or something that runs long enough to eat into commute/prep time).

**Turn 2 (user):** "yeah I watched the first one, it was really good actually, felt exactly right for a wind-down before work"

**what_to_watch_for:**
- Should tag this feedback against the specific `rec_id` from turn 1, not
  generically.
- Should show visible profile evolution — e.g. explicitly noting this as a
  new "known good window" (afternoon pre-shift, medium energy) rather than
  just filing it as a taste data point.

---

## Persona 2: 8am–7pm student (the report's canonical example)

**Profile status:** empty — first-ever interaction.

**seed_context:**
```
Context: profile_status=empty. No prior data.
```

**Turn 1 (user):** "hi"

**what_to_watch_for:**
- Should trigger onboarding (warm, conversational, not a form-like list of
  questions all at once).
- Should NOT jump straight to recommendations with no taste data.

**Turn 2 (user):** "I'm a student, classes 8am-7pm most days. I loved Attack on Titan for how dark and intense it got, and I recently read Klara and the Sun which was beautifully sad."

**Turn 3 (user):** "not sure what I'm in the mood for tonight, whatever you think"

**what_to_watch_for:**
- Should proactively suggest a realistic evening window (something like
  9:00-10:30pm) unprompted — this is the exact behavior described as the
  hackathon's key differentiator.
- Should explicitly protect sleep/next-day energy in its reasoning, not
  just mention a time window as an aside.
- Recommendation reasoning should connect to both anchor favorites (dark
  intensity, emotional beauty), not generic genre-matching.

---

## Persona 3: Chaotic freelancer (stress-tests time-awareness with NO fixed rhythm)

**Profile status:** established — profile is developed but schedule is
inherently irregular, which stresses whether the agent falls back to
generic advice when it can't rely on a fixed daily pattern.

**seed_context:**
```
Context: profile_status=established. Taste: high affinity for fast-paced
thrillers and anime with strong worldbuilding, dislikes slow openings.
known_good_windows: none reliable — schedule varies daily depending on
client deadlines. feedback_log has 3 prior entries, most recent: loved
"Made in Abyss" S1 for its atmosphere, disliked a slow-burn literary novel
for "taking too long to get anywhere."
```

**Turn 1 (user):** "no idea when I'll be free today, could be 30 min, could be 3 hours, depends on a client call"

**what_to_watch_for:**
- Should NOT default to a rigid time-window suggestion the way it would for
  a student/worker — should acknowledge the uncertainty and either offer a
  flexible/modular option (e.g. a single episode that works whether they
  get 30 min or 3 hours) or ask one clarifying question.
- Should still apply the established taste profile (fast-paced,
  strong worldbuilding, no slow openers) rather than reverting to generic
  suggestions just because schedule data is thin.
- Good agent behavior here is the differentiator between "time-aware" and
  "time-rigid" — this persona is the one most likely to expose that gap.

---

## Quick pass/fail checklist (use across all three)

- [ ] Recommendations are tagged with a `rec_id` per the output contract
- [ ] Reasoning references specific past feedback or anchor favorites, not
      generic genre statements
- [ ] Time suggestions are derived from *this* persona's rhythm, not a
      default evening assumption
- [ ] Sleep/energy protection is explicit when relevant
- [ ] Feedback in turn 2/3 visibly updates the model's stated understanding
      of the user (say it out loud, don't just silently absorb it)
- [ ] Tone stays warm and librarian-like, never listy or transactional
