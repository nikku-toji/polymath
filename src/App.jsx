import React, { useState, useRef, useEffect } from "react";
import {
  Brain, ArrowRight, Check, X, RotateCcw, Target,
  ChevronRight, Layers, Compass, CircleDot, CornerDownLeft,
} from "lucide-react";

/* ----------------------------------------------------------------
   POLYMATH — an exocortex for learning anything.
   Adaptive AI tutor: builds a path, teaches Socratically, and
   reinforces with spaced repetition.

   This build talks to the local Express proxy at /api/claude,
   which holds your API key. The key never reaches the browser.
-----------------------------------------------------------------*/

async function callClaude(system, messages) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseJSON(text) {
  let t = (text || "").trim();
  t = t.replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("no json");
  return JSON.parse(t.slice(first, last + 1));
}

const LEVELS = [
  { id: "new", label: "Total beginner" },
  { id: "some", label: "Know the basics" },
  { id: "inter", label: "Intermediate" },
];

export default function App() {
  const [screen, setScreen] = useState("setup"); // setup | path | learning | review
  const [skill, setSkill] = useState("");
  const [level, setLevel] = useState("new");
  const [goal, setGoal] = useState("");

  const [path, setPath] = useState(null);
  const [mastered, setMastered] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [concept, setConcept] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState([]);
  const [conceptDone, setConceptDone] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);

  const [cards, setCards] = useState([]);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const answerRef = useRef(null);
  const levelLabel = LEVELS.find((l) => l.id === level)?.label || "";

  async function buildPath() {
    if (!skill.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const sys =
        "You are a world-class curriculum designer. Given a skill the learner wants to master, their current level, and their goal, produce an ordered learning path of the most important concepts — the true load-bearing ideas, sequenced so each builds on the last. Respond with ONLY valid JSON, no markdown, no backticks, no preamble. Schema: {\"skill\":string,\"summary\":string (one vivid sentence on what mastery unlocks),\"concepts\":[{\"id\":string,\"title\":string,\"why\":string (one short line on why it matters)}]}. Provide 6 to 8 concepts.";
      const usr = `Skill: ${skill}\nCurrent level: ${levelLabel}\nGoal: ${goal || "general mastery"}`;
      const out = await callClaude(sys, [{ role: "user", content: usr }]);
      const parsed = parseJSON(out);
      parsed.concepts = parsed.concepts.map((c, i) => ({ ...c, id: c.id || `c${i}` }));
      setPath(parsed);
      setMastered([]);
      setCards([]);
      setScreen("path");
    } catch (e) {
      setError("Couldn't build the path. Check the server is running and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openConcept(c) {
    setConcept(c);
    setScreen("learning");
    setLesson(null);
    setHistory([]);
    setAnswer("");
    setConceptDone(false);
    setCorrectCount(0);
    setError("");
    setBusy(true);
    try {
      const sys =
        "You are an extraordinary tutor. Teach ONE concept with crystal clarity, calibrated to the learner's level. Be concise and concrete. Respond with ONLY valid JSON, no markdown, no backticks. Schema: {\"lesson_paragraphs\":[string,string] (2 short plain-language paragraphs),\"analogy\":string (one vivid everyday analogy),\"question\":string (one active-recall question that forces the learner to reason, not just recall a definition)}.";
      const usr = `Skill: ${skill}\nLearner level: ${levelLabel}\nConcept to teach: ${c.title}\nWhy it matters: ${c.why || ""}`;
      const out = await callClaude(sys, [{ role: "user", content: usr }]);
      const parsed = parseJSON(out);
      setLesson(parsed);
      setQuestion(parsed.question);
    } catch (e) {
      setError("Lesson failed to load. Go back and reopen the concept.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer() {
    if (!answer.trim() || busy) return;
    setBusy(true);
    setError("");
    const askedQ = question;
    const myAnswer = answer;
    try {
      const sys =
        "You are a rigorous but encouraging tutor running an adaptive check for understanding. Judge the learner's answer honestly, correct any misconception specifically, then decide the next step. If they clearly grasp the idea, mark mastered=true. Otherwise ask one follow-up that targets exactly where they're shaky. Respond with ONLY valid JSON, no markdown, no backticks. Schema: {\"verdict\":\"correct\"|\"partial\"|\"incorrect\",\"feedback\":string (1-2 sentences, specific),\"mastered\":boolean,\"next_question\":string|null}.";
      const ctx = `Skill: ${skill}\nLevel: ${levelLabel}\nConcept: ${concept.title}\nQuestion asked: ${askedQ}\nLearner's answer: ${myAnswer}`;
      const out = await callClaude(sys, [{ role: "user", content: ctx }]);
      const r = parseJSON(out);
      const newHist = [...history, { q: askedQ, a: myAnswer, verdict: r.verdict, feedback: r.feedback }];
      setHistory(newHist);
      setAnswer("");
      const nextCorrect = r.verdict === "correct" ? correctCount + 1 : correctCount;
      setCorrectCount(nextCorrect);
      const done = r.mastered || !r.next_question || nextCorrect >= 2;
      if (done) {
        markMastered();
        await makeCards();
        setConceptDone(true);
      } else {
        setQuestion(r.next_question);
      }
    } catch (e) {
      setError("Something glitched grading that. Try submitting again.");
    } finally {
      setBusy(false);
    }
  }

  function markMastered() {
    setMastered((m) => (m.includes(concept.id) ? m : [...m, concept.id]));
  }

  async function makeCards() {
    try {
      const sys =
        "Create spaced-repetition flashcards for active recall. Fronts are questions or prompts; backs are tight answers. Respond with ONLY valid JSON, no markdown, no backticks. Schema: {\"cards\":[{\"front\":string,\"back\":string}]}. Provide exactly 3 cards.";
      const usr = `Skill: ${skill}\nConcept just mastered: ${concept.title}`;
      const out = await callClaude(sys, [{ role: "user", content: usr }]);
      const r = parseJSON(out);
      const fresh = (r.cards || []).map((c) => ({ ...c, box: 1, concept: concept.title }));
      setCards((prev) => [...prev, ...fresh]);
    } catch (e) {
      /* non-fatal */
    }
  }

  function startReview() {
    const ordered = [...cards].sort((a, b) => a.box - b.box);
    setCards(ordered);
    setReviewIdx(0);
    setRevealed(false);
    setScreen("review");
  }

  function rateCard(got) {
    setCards((prev) => {
      const copy = [...prev];
      const card = { ...copy[reviewIdx] };
      card.box = got ? Math.min(3, card.box + 1) : 1;
      copy[reviewIdx] = card;
      return copy;
    });
    if (reviewIdx + 1 < cards.length) {
      setReviewIdx(reviewIdx + 1);
      setRevealed(false);
    } else {
      const reordered = [...cards].sort((a, b) => a.box - b.box);
      setCards(reordered);
      setReviewIdx(0);
      setRevealed(false);
      setScreen("path");
    }
  }

  function reset() {
    setScreen("setup");
    setPath(null);
    setSkill("");
    setGoal("");
    setMastered([]);
    setCards([]);
    setError("");
  }

  useEffect(() => {
    if (screen === "learning" && lesson && answerRef.current) answerRef.current.focus();
  }, [lesson, question, screen]);

  const progress = path ? Math.round((mastered.length / path.concepts.length) * 100) : 0;

  return (
    <div className="pm-root">
      <style>{CSS}</style>
      <div className="pm-grain" />

      <header className="pm-header">
        <div className="pm-brand">
          <Brain size={20} strokeWidth={1.6} />
          <span className="pm-word">POLYMATH</span>
        </div>
        <span className="pm-tag">an exocortex for learning anything</span>
      </header>

      <main className="pm-main">
        {screen === "setup" && (
          <div className="pm-stage pm-fade">
            <p className="pm-eyebrow">001 — DEFINE THE CLIMB</p>
            <h1 className="pm-h1">
              What do you want to<br />
              <span className="pm-accent">actually master?</span>
            </h1>
            <p className="pm-lede">
              Name a skill. I'll map the load-bearing ideas, teach each one by making you
              <em> reason</em>, not memorize, and adapt to exactly where you're shaky.
            </p>

            <label className="pm-label">THE SKILL</label>
            <input
              className="pm-input pm-big"
              placeholder="e.g. negotiation, systems design, jazz improv, options trading…"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buildPath()}
            />

            <label className="pm-label" style={{ marginTop: 26 }}>WHERE YOU'RE STARTING</label>
            <div className="pm-levels">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  className={`pm-level ${level === l.id ? "on" : ""}`}
                  onClick={() => setLevel(l.id)}
                >
                  <CircleDot size={13} strokeWidth={2} />
                  {l.label}
                </button>
              ))}
            </div>

            <label className="pm-label" style={{ marginTop: 26 }}>YOUR GOAL <span className="pm-opt">(optional)</span></label>
            <input
              className="pm-input"
              placeholder="e.g. close my first deal, pass an interview, build intuition…"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buildPath()}
            />

            {error && <p className="pm-error">{error}</p>}

            <button className="pm-cta" onClick={buildPath} disabled={busy || !skill.trim()}>
              {busy ? <span className="pm-spin" /> : <Compass size={17} strokeWidth={1.8} />}
              {busy ? "Mapping the terrain…" : "Build my path"}
              {!busy && <ArrowRight size={17} strokeWidth={1.8} />}
            </button>
          </div>
        )}

        {screen === "path" && path && (
          <div className="pm-stage pm-fade">
            <p className="pm-eyebrow">002 — THE PATH · {skill.toUpperCase()}</p>
            <h2 className="pm-h2">{path.summary}</h2>

            <div className="pm-meter">
              <div className="pm-meter-bar"><span style={{ width: `${progress}%` }} /></div>
              <span className="pm-meter-num">{mastered.length}/{path.concepts.length} mastered</span>
            </div>

            <ol className="pm-concepts">
              {path.concepts.map((c, i) => {
                const done = mastered.includes(c.id);
                return (
                  <li key={c.id} className={`pm-concept ${done ? "done" : ""}`} onClick={() => openConcept(c)}>
                    <span className="pm-cnum">{done ? <Check size={15} strokeWidth={2.5} /> : String(i + 1).padStart(2, "0")}</span>
                    <span className="pm-ctext">
                      <span className="pm-ctitle">{c.title}</span>
                      <span className="pm-cwhy">{c.why}</span>
                    </span>
                    <ChevronRight className="pm-carrow" size={18} strokeWidth={1.8} />
                  </li>
                );
              })}
            </ol>

            <div className="pm-pathfoot">
              <button className="pm-ghost" onClick={reset}>
                <RotateCcw size={14} strokeWidth={1.8} /> New skill
              </button>
              {cards.length > 0 && (
                <button className="pm-cta pm-cta-sm" onClick={startReview}>
                  <Layers size={16} strokeWidth={1.8} /> Review {cards.length} cards
                </button>
              )}
            </div>
          </div>
        )}

        {screen === "learning" && concept && (
          <div className="pm-stage pm-fade">
            <button className="pm-back" onClick={() => setScreen("path")}>← path</button>
            <p className="pm-eyebrow">LEARNING</p>
            <h2 className="pm-h2">{concept.title}</h2>

            {!lesson && busy && (
              <div className="pm-loading"><span className="pm-spin dark" /> Composing the lesson…</div>
            )}

            {lesson && (
              <>
                <div className="pm-lesson">
                  {lesson.lesson_paragraphs?.map((p, i) => <p key={i}>{p}</p>)}
                  {lesson.analogy && (
                    <div className="pm-analogy">
                      <span className="pm-analogy-tag">THINK OF IT LIKE</span>
                      {lesson.analogy}
                    </div>
                  )}
                </div>

                {history.length > 0 && (
                  <div className="pm-thread">
                    {history.map((h, i) => (
                      <div key={i} className="pm-turn">
                        <p className="pm-tq">{h.q}</p>
                        <p className="pm-ta">{h.a}</p>
                        <p className={`pm-tf v-${h.verdict}`}>
                          <span className="pm-vdot" /> {h.feedback}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {!conceptDone && (
                  <div className="pm-qa">
                    <p className="pm-question"><Target size={15} strokeWidth={2} /> {question}</p>
                    <textarea
                      ref={answerRef}
                      className="pm-answer"
                      placeholder="Reason it out in your own words…"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAnswer();
                      }}
                      rows={3}
                    />
                    <div className="pm-qa-foot">
                      <span className="pm-hint"><CornerDownLeft size={12} /> Ctrl/Cmd + Enter</span>
                      <button className="pm-cta pm-cta-sm" onClick={submitAnswer} disabled={busy || !answer.trim()}>
                        {busy ? <span className="pm-spin" /> : <ArrowRight size={16} strokeWidth={1.8} />}
                        {busy ? "Thinking…" : "Submit"}
                      </button>
                    </div>
                  </div>
                )}

                {conceptDone && (
                  <div className="pm-done pm-fade">
                    <div className="pm-done-badge"><Check size={20} strokeWidth={2.5} /></div>
                    <p className="pm-done-title">Concept locked in.</p>
                    <p className="pm-done-sub">3 review cards added to your deck to keep it from fading.</p>
                    <button className="pm-cta pm-cta-sm" onClick={() => setScreen("path")}>
                      Back to path <ArrowRight size={16} strokeWidth={1.8} />
                    </button>
                  </div>
                )}

                {error && <p className="pm-error">{error}</p>}
              </>
            )}
          </div>
        )}

        {screen === "review" && cards.length > 0 && (
          <div className="pm-stage pm-fade">
            <button className="pm-back" onClick={() => setScreen("path")}>← path</button>
            <p className="pm-eyebrow">SPACED REVIEW · {reviewIdx + 1}/{cards.length}</p>

            <div className={`pm-card ${revealed ? "flip" : ""}`} onClick={() => setRevealed(true)}>
              <div className="pm-card-meta">
                <span>{cards[reviewIdx].concept}</span>
                <span className="pm-strength">
                  {[1, 2, 3].map((b) => (
                    <i key={b} className={cards[reviewIdx].box >= b ? "on" : ""} />
                  ))}
                </span>
              </div>
              <p className="pm-card-front">{cards[reviewIdx].front}</p>
              {revealed ? (
                <p className="pm-card-back">{cards[reviewIdx].back}</p>
              ) : (
                <p className="pm-card-reveal">tap to reveal</p>
              )}
            </div>

            {revealed && (
              <div className="pm-rate pm-fade">
                <button className="pm-miss" onClick={() => rateCard(false)}><X size={16} strokeWidth={2.2} /> Missed it</button>
                <button className="pm-got" onClick={() => rateCard(true)}><Check size={16} strokeWidth={2.2} /> Got it</button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="pm-footer">
        <span>Live-tutored by Claude · you reason, it adapts</span>
      </footer>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

.pm-root{
  --ink:#13110E; --ink2:#1C1A16; --cream:#F3EEE3; --cream-d:#C9C2B2;
  --amber:#E3A52B; --amber-soft:#f0c878; --line:rgba(243,238,227,.12);
  --good:#7FB069; --partial:#E3A52B; --bad:#D6694E;
  position:relative; min-height:100vh; width:100%;
  background:
    radial-gradient(120% 90% at 85% -10%, rgba(227,165,43,.10), transparent 55%),
    radial-gradient(90% 70% at -10% 110%, rgba(227,165,43,.06), transparent 50%),
    var(--ink);
  color:var(--cream); font-family:'DM Sans',sans-serif;
  -webkit-font-smoothing:antialiased; overflow-x:hidden;
}
.pm-grain{position:fixed; inset:0; pointer-events:none; opacity:.05; z-index:0;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}

.pm-header{position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between;
  padding:22px 28px; border-bottom:1px solid var(--line);}
.pm-brand{display:flex; align-items:center; gap:10px; color:var(--amber);}
.pm-word{font-family:'JetBrains Mono',monospace; font-weight:500; letter-spacing:.32em; font-size:14px; color:var(--cream);}
.pm-tag{font-family:'JetBrains Mono',monospace; font-size:10.5px; letter-spacing:.18em; color:var(--cream-d); opacity:.7; text-transform:lowercase;}

.pm-main{position:relative; z-index:1; display:flex; justify-content:center; padding:54px 24px 30px;}
.pm-stage{width:100%; max-width:620px;}
.pm-fade{animation:fade .5s cubic-bezier(.2,.7,.2,1) both;}
@keyframes fade{from{opacity:0; transform:translateY(14px);}to{opacity:1; transform:none;}}

.pm-eyebrow{font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.24em; color:var(--amber); margin:0 0 18px;}
.pm-h1{font-family:'Fraunces',serif; font-weight:500; font-size:clamp(34px,6vw,52px); line-height:1.02; letter-spacing:-.01em; margin:0 0 18px;}
.pm-accent{font-style:italic; color:var(--amber-soft);}
.pm-h2{font-family:'Fraunces',serif; font-weight:500; font-size:clamp(24px,4vw,32px); line-height:1.12; letter-spacing:-.01em; margin:0 0 22px; color:var(--cream);}
.pm-lede{font-size:16px; line-height:1.6; color:var(--cream-d); margin:0 0 34px; max-width:520px;}
.pm-lede em{color:var(--cream); font-style:italic;}

.pm-label{display:block; font-family:'JetBrains Mono',monospace; font-size:10.5px; letter-spacing:.2em; color:var(--cream-d); margin:0 0 10px;}
.pm-opt{opacity:.5; letter-spacing:.1em;}
.pm-input{width:100%; box-sizing:border-box; background:var(--ink2); border:1px solid var(--line);
  border-radius:12px; padding:15px 16px; color:var(--cream); font-family:'DM Sans',sans-serif; font-size:15px;
  outline:none; transition:border-color .2s, box-shadow .2s;}
.pm-input::placeholder{color:rgba(201,194,178,.4);}
.pm-input:focus{border-color:var(--amber); box-shadow:0 0 0 3px rgba(227,165,43,.12);}
.pm-big{font-size:17px; padding:18px 18px;}

.pm-levels{display:flex; gap:10px; flex-wrap:wrap;}
.pm-level{display:flex; align-items:center; gap:8px; background:var(--ink2); border:1px solid var(--line);
  color:var(--cream-d); border-radius:10px; padding:11px 15px; font-family:'DM Sans',sans-serif; font-size:13.5px;
  cursor:pointer; transition:all .18s;}
.pm-level svg{opacity:.4; transition:all .18s;}
.pm-level:hover{border-color:rgba(243,238,227,.28); color:var(--cream);}
.pm-level.on{border-color:var(--amber); color:var(--cream); background:rgba(227,165,43,.08);}
.pm-level.on svg{opacity:1; color:var(--amber);}

.pm-cta{display:inline-flex; align-items:center; gap:10px; margin-top:34px; background:var(--amber);
  color:#1a1610; border:none; border-radius:12px; padding:15px 24px; font-family:'DM Sans',sans-serif;
  font-weight:600; font-size:15px; cursor:pointer; transition:transform .15s, box-shadow .2s, opacity .2s;
  box-shadow:0 8px 28px -10px rgba(227,165,43,.6);}
.pm-cta:hover:not(:disabled){transform:translateY(-2px); box-shadow:0 12px 34px -10px rgba(227,165,43,.7);}
.pm-cta:disabled{opacity:.5; cursor:not-allowed;}
.pm-cta-sm{margin-top:0; padding:11px 18px; font-size:13.5px; border-radius:10px;}

.pm-error{color:var(--bad); font-size:13.5px; margin-top:16px; font-family:'JetBrains Mono',monospace;}

.pm-spin{width:16px; height:16px; border-radius:50%; border:2px solid rgba(26,22,16,.3); border-top-color:#1a1610;
  display:inline-block; animation:spin .7s linear infinite;}
.pm-spin.dark{border:2px solid rgba(243,238,227,.2); border-top-color:var(--amber);}
@keyframes spin{to{transform:rotate(360deg);}}

.pm-meter{display:flex; align-items:center; gap:14px; margin:0 0 28px;}
.pm-meter-bar{flex:1; height:5px; background:var(--ink2); border-radius:99px; overflow:hidden;}
.pm-meter-bar span{display:block; height:100%; background:linear-gradient(90deg,var(--amber),var(--amber-soft));
  border-radius:99px; transition:width .6s cubic-bezier(.2,.7,.2,1);}
.pm-meter-num{font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--cream-d); letter-spacing:.06em; white-space:nowrap;}

.pm-concepts{list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:9px;}
.pm-concept{display:flex; align-items:center; gap:16px; background:var(--ink2); border:1px solid var(--line);
  border-radius:13px; padding:16px 18px; cursor:pointer; transition:all .18s;}
.pm-concept:hover{border-color:rgba(227,165,43,.45); transform:translateX(4px);}
.pm-cnum{flex-shrink:0; width:30px; height:30px; display:flex; align-items:center; justify-content:center;
  font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--amber); border:1px solid var(--line); border-radius:8px;}
.pm-concept.done .pm-cnum{background:var(--good); color:#13110E; border-color:var(--good);}
.pm-concept.done{opacity:.7;}
.pm-ctext{display:flex; flex-direction:column; gap:3px; flex:1;}
.pm-ctitle{font-family:'Fraunces',serif; font-size:17px; font-weight:500; color:var(--cream); letter-spacing:-.005em;}
.pm-cwhy{font-size:13px; color:var(--cream-d); line-height:1.4;}
.pm-carrow{color:var(--cream-d); opacity:.4; flex-shrink:0;}
.pm-concept:hover .pm-carrow{opacity:1; color:var(--amber);}

.pm-pathfoot{display:flex; align-items:center; justify-content:space-between; margin-top:28px;}
.pm-ghost{display:inline-flex; align-items:center; gap:8px; background:none; border:1px solid var(--line);
  color:var(--cream-d); border-radius:10px; padding:10px 16px; font-family:'DM Sans',sans-serif; font-size:13px;
  cursor:pointer; transition:all .18s;}
.pm-ghost:hover{color:var(--cream); border-color:rgba(243,238,227,.3);}

.pm-back{background:none; border:none; color:var(--cream-d); font-family:'JetBrains Mono',monospace; font-size:12px;
  cursor:pointer; padding:0; margin:0 0 22px; letter-spacing:.06em; transition:color .18s;}
.pm-back:hover{color:var(--amber);}
.pm-loading{display:flex; align-items:center; gap:12px; color:var(--cream-d); font-size:14px; padding:24px 0;}

.pm-lesson{font-size:15.5px; line-height:1.68; color:var(--cream); }
.pm-lesson p{margin:0 0 15px;}
.pm-analogy{background:rgba(227,165,43,.07); border-left:2px solid var(--amber); border-radius:0 10px 10px 0;
  padding:14px 18px; margin:8px 0 4px; font-size:14.5px; line-height:1.6; color:var(--cream-d);}
.pm-analogy-tag{display:block; font-family:'JetBrains Mono',monospace; font-size:9.5px; letter-spacing:.18em;
  color:var(--amber); margin-bottom:7px;}

.pm-thread{margin:26px 0 8px; display:flex; flex-direction:column; gap:16px;}
.pm-turn{border-top:1px solid var(--line); padding-top:16px;}
.pm-tq{font-family:'Fraunces',serif; font-style:italic; font-size:15px; color:var(--cream-d); margin:0 0 8px;}
.pm-ta{font-size:14.5px; color:var(--cream); margin:0 0 8px; padding-left:14px; border-left:2px solid var(--line);}
.pm-tf{font-size:13.5px; line-height:1.5; margin:0; display:flex; gap:8px; align-items:flex-start; color:var(--cream-d);}
.pm-vdot{width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:5px;}
.v-correct .pm-vdot{background:var(--good);} .v-partial .pm-vdot{background:var(--partial);} .v-incorrect .pm-vdot{background:var(--bad);}

.pm-qa{margin-top:26px;}
.pm-question{display:flex; gap:9px; align-items:flex-start; font-family:'Fraunces',serif; font-size:18px;
  line-height:1.4; color:var(--cream); margin:0 0 14px;}
.pm-question svg{color:var(--amber); flex-shrink:0; margin-top:5px;}
.pm-answer{width:100%; box-sizing:border-box; background:var(--ink2); border:1px solid var(--line); border-radius:12px;
  padding:14px 16px; color:var(--cream); font-family:'DM Sans',sans-serif; font-size:15px; resize:vertical; outline:none;
  line-height:1.5; transition:border-color .2s, box-shadow .2s;}
.pm-answer::placeholder{color:rgba(201,194,178,.4);}
.pm-answer:focus{border-color:var(--amber); box-shadow:0 0 0 3px rgba(227,165,43,.12);}
.pm-qa-foot{display:flex; align-items:center; justify-content:space-between; margin-top:12px;}
.pm-hint{display:inline-flex; align-items:center; gap:6px; font-family:'JetBrains Mono',monospace; font-size:10.5px;
  color:var(--cream-d); opacity:.6;}

.pm-done{text-align:center; padding:34px 0 12px;}
.pm-done-badge{width:52px; height:52px; border-radius:50%; background:var(--good); color:#13110E;
  display:flex; align-items:center; justify-content:center; margin:0 auto 18px;}
.pm-done-title{font-family:'Fraunces',serif; font-size:23px; color:var(--cream); margin:0 0 6px;}
.pm-done-sub{font-size:14px; color:var(--cream-d); margin:0 0 22px;}

.pm-card{background:var(--ink2); border:1px solid var(--line); border-radius:18px; padding:30px 28px; min-height:220px;
  display:flex; flex-direction:column; cursor:pointer; transition:border-color .2s, transform .2s;}
.pm-card:hover{border-color:rgba(227,165,43,.3);}
.pm-card.flip{cursor:default;}
.pm-card-meta{display:flex; align-items:center; justify-content:space-between; margin-bottom:22px;}
.pm-card-meta>span:first-child{font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:.14em;
  color:var(--cream-d); text-transform:uppercase;}
.pm-strength{display:flex; gap:4px;}
.pm-strength i{width:16px; height:4px; border-radius:2px; background:var(--line);}
.pm-strength i.on{background:var(--amber);}
.pm-card-front{font-family:'Fraunces',serif; font-size:21px; line-height:1.4; color:var(--cream); margin:0; flex:1;}
.pm-card-reveal{font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.14em; color:var(--cream-d);
  opacity:.5; margin:18px 0 0; text-align:center;}
.pm-card-back{margin:20px 0 0; padding-top:20px; border-top:1px solid var(--line); font-size:15.5px; line-height:1.6;
  color:var(--amber-soft); animation:fade .35s both;}

.pm-rate{display:flex; gap:12px; margin-top:18px;}
.pm-miss,.pm-got{flex:1; display:flex; align-items:center; justify-content:center; gap:9px; padding:15px;
  border-radius:12px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:14.5px; cursor:pointer;
  border:1px solid var(--line); transition:all .18s;}
.pm-miss{background:rgba(214,105,78,.1); color:var(--bad);} .pm-miss:hover{background:rgba(214,105,78,.18);}
.pm-got{background:rgba(127,176,105,.12); color:var(--good);} .pm-got:hover{background:rgba(127,176,105,.2);}

.pm-footer{position:relative; z-index:1; text-align:center; padding:22px; border-top:1px solid var(--line);
  font-family:'JetBrains Mono',monospace; font-size:10.5px; letter-spacing:.1em; color:var(--cream-d); opacity:.55;}

@media(max-width:560px){
  .pm-header{padding:18px 18px;} .pm-tag{display:none;}
  .pm-main{padding:36px 18px 24px;} .pm-levels{flex-direction:column;}
  .pm-level{justify-content:flex-start;}
}
`;
