/**
 * neighbor_diff_analysis.js
 *
 * Deep analysis of how DIFFERENT adjacent students' papers are.
 * Key exam-hall cheating concern: students ±5 seats away should see
 * maximally different questions — different selection window AND different order.
 *
 * Metrics per student-pair:
 *   • shared_count     — how many of the 30 questions both students received
 *   • position_matches — of the shared questions, how many land at same seat number
 *   • copyability      — position_matches / total_questions (0 = impossible to copy, 1 = identical)
 *   • order_similarity — Spearman-like rank correlation on shared questions
 */

'use strict';

const crypto = require('crypto');

// ─── Algorithm verbatim from assigned-paper.ts ────────────────────────────────
function hashText(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function seededRandom(seed) {
  let state = parseInt(hashText(seed).slice(0, 8), 16) || 0x12345678;
  return () => {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleDeterministic(items, seed) {
  const out = [...items]; const r = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function rotateArray(items, offset) {
  if (!items.length) return [];
  const n = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(n), ...items.slice(0, n)];
}
function isPrime(n) {
  if (n < 2) return false; if (n === 2) return true; if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false; return true;
}
function selectionStepForPool(poolSize) {
  if (poolSize <= 2) return 1;
  let c = Math.floor(poolSize / 2) + 1;
  while (c < poolSize) { if (isPrime(c) && poolSize % c !== 0) return c; c++; }
  c = poolSize - 1;
  while (c > 1) { if (isPrime(c) && poolSize % c !== 0) return c; c--; }
  return 1;
}
function computePositionCollisionRate(a, b) {
  if (!a.length || !b.length) return 0;
  const bPos = new Map(b.map(q => [q.version_question_id, q.student_question_order]));
  let hits = 0;
  for (const q of a) if (bPos.get(q.version_question_id) === q.student_question_order) hits++;
  return hits / Math.max(a.length, b.length);
}
function buildSectionOrdering(questionsInSection, deliverCount, assignedStudentNumber, variantSeed, sectionCode, orderStrategy, perturbation) {
  const available = questionsInSection.length;
  let chosen;
  if (deliverCount >= available) {
    chosen = [...questionsInSection];
  } else {
    const stepSize = selectionStepForPool(available);
    const offset = (assignedStudentNumber * stepSize) % available;
    chosen = rotateArray(questionsInSection, offset).slice(0, deliverCount);
  }
  if (orderStrategy === 'ORIGINAL') return [...chosen].sort((a, b) => a.question_order - b.question_order);
  const shuffleSeed = perturbation === 0 ? `${variantSeed}:${sectionCode}` : hashText(`${variantSeed}:${sectionCode}:p${perturbation}`);
  return shuffleDeterministic(chosen, shuffleSeed);
}

// ─── Setup ────────────────────────────────────────────────────────────────────
const EXAM_ID = 1, VERSION_ID = 1;
const N_STUDENTS = 100, QUESTIONS_PER_SECTION = 40, DELIVER_PER_SECTION = 30;
const SECTIONS = ['PHYSICS', 'CHEMISTRY', 'MATHS'];
const VARIANT_SALT = 'examination-assigned-paper-v1';
function deriveVariantSeed(examId, studentId, gateSessionId, assignedStudentNumber, versionId) {
  return hashText([examId, studentId, gateSessionId, assignedStudentNumber, versionId, VARIANT_SALT].join(':'));
}

const allQuestions = [];
SECTIONS.forEach((section, si) => {
  for (let qi = 1; qi <= QUESTIONS_PER_SECTION; qi++) {
    allQuestions.push({ id: si * QUESTIONS_PER_SECTION + qi, section_code: section, question_order: qi });
  }
});

const sectionRules = SECTIONS.map(section => ({
  section: { section_code: section, section_order: SECTIONS.indexOf(section) + 1, question_count_target: DELIVER_PER_SECTION },
  questionsToDeliver: DELIVER_PER_SECTION,
  orderStrategy: 'ROTATED_SHUFFLED',
}));

// ─── Generate all 100 papers ──────────────────────────────────────────────────
const MAX_PERTURBATION = 5, COLLISION_THRESHOLD = 0.12, NEIGHBOR_CHECK_COUNT = 5;

const papers = []; // { studentNumber, variantSeed, qids: Set, posMap: Map<qid, globalPos> }

for (let s = 1; s <= N_STUDENTS; s++) {
  const studentId = 1000 + s, gateSessionId = 2000 + s;
  const variantSeed = deriveVariantSeed(EXAM_ID, studentId, gateSessionId, s, VERSION_ID);
  const neighborPositions = papers.slice(Math.max(0, s - 1 - NEIGHBOR_CHECK_COUNT), s - 1)
    .map(p => [...p.posMap.entries()].map(([qid, pos]) => ({ version_question_id: qid, student_question_order: pos })));

  let bestQuestions = null, bestMaxCollision = 2.0, usedPerturbation = 0;

  for (let perturbation = 0; perturbation <= MAX_PERTURBATION; perturbation++) {
    const candidateQuestions = [];
    for (const sectionRule of sectionRules) {
      const questionsInSection = allQuestions.filter(q => q.section_code === sectionRule.section.section_code);
      const deliverCount = Math.min(sectionRule.questionsToDeliver, questionsInSection.length);
      const ordered = buildSectionOrdering(questionsInSection, deliverCount, s, variantSeed, sectionRule.section.section_code, sectionRule.orderStrategy, perturbation);
      ordered.forEach((q, i) => candidateQuestions.push({ version_question_id: q.id, section_code: q.section_code, sectionQuestionOrder: i + 1, studentQuestionOrder: candidateQuestions.length + 1 }));
    }
    const candidatePositions = candidateQuestions.map(q => ({ version_question_id: q.version_question_id, student_question_order: q.studentQuestionOrder }));
    const collisionRates = neighborPositions.map(n => computePositionCollisionRate(candidatePositions, n));
    const maxCollision = collisionRates.length > 0 ? Math.max(...collisionRates) : 0;
    if (maxCollision < bestMaxCollision) { bestMaxCollision = maxCollision; bestQuestions = candidateQuestions; usedPerturbation = perturbation; }
    if (maxCollision <= COLLISION_THRESHOLD) break;
  }

  const posMap = new Map(bestQuestions.map(q => [q.version_question_id, q.studentQuestionOrder]));
  const sectionMaps = {};
  for (const sec of SECTIONS) {
    sectionMaps[sec] = new Map(bestQuestions.filter(q => q.section_code === sec).map(q => [q.version_question_id, q.sectionQuestionOrder]));
  }
  papers.push({ studentNumber: s, variantSeed, qids: new Set(bestQuestions.map(q => q.version_question_id)), posMap, sectionMaps, usedPerturbation, maxCollision: bestMaxCollision });
}

// ─── Pairwise difference analysis ────────────────────────────────────────────
function analyzePair(paperA, paperB) {
  const sharedQids = [...paperA.qids].filter(qid => paperB.qids.has(qid));
  const sharedCount = sharedQids.length;
  const totalQuestions = paperA.posMap.size; // 90

  // Position matches: same qid at same global position
  let positionMatches = 0;
  for (const qid of sharedQids) {
    if (paperA.posMap.get(qid) === paperB.posMap.get(qid)) positionMatches++;
  }

  // Section-level analysis
  const sectionStats = {};
  for (const sec of SECTIONS) {
    const aSet = paperA.sectionMaps[sec];
    const bSet = paperB.sectionMaps[sec];
    const sharedSec = [...aSet.keys()].filter(q => bSet.has(q));
    let secPosMatches = 0;
    for (const qid of sharedSec) { if (aSet.get(qid) === bSet.get(qid)) secPosMatches++; }
    sectionStats[sec] = {
      sharedCount: sharedSec.length,
      totalPerSection: DELIVER_PER_SECTION,
      positionMatches: secPosMatches,
    };
  }

  // Copyability: out of 90 questions, how many are at identical positions?
  const copyabilityPct = (positionMatches / totalQuestions * 100);
  // Selection overlap: out of 90 questions each, how many same questions?
  const selectionOverlapPct = (sharedCount / totalQuestions * 100);

  return { sharedCount, selectionOverlapPct, positionMatches, copyabilityPct, sectionStats, gap: Math.abs(paperB.studentNumber - paperA.studentNumber) };
}

// Collect all ±1..±5 neighbor pairs
const neighborResults = []; // { gap, copyabilityPct, selectionOverlapPct, positionMatches }
const gapBuckets = {}; // gap -> array of copyabilityPct

for (let i = 0; i < papers.length; i++) {
  for (let gap = 1; gap <= 5; gap++) {
    const j = i + gap;
    if (j >= papers.length) continue;
    const result = analyzePair(papers[i], papers[j]);
    neighborResults.push({ studentA: papers[i].studentNumber, studentB: papers[j].studentNumber, gap, ...result });
    if (!gapBuckets[gap]) gapBuckets[gap] = [];
    gapBuckets[gap].push(result.copyabilityPct);
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('   NEIGHBOR DIFFERENCE ANALYSIS — Adjacent Student Paper Comparison');
console.log('   (Anti-cheating verification: students ±5 seats apart)');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log(`  Pool: ${QUESTIONS_PER_SECTION}×3=120 questions | Deliver: ${DELIVER_PER_SECTION}×3=90 per student | 100 students\n`);

// Gap summary table
console.log('─── Copyability by seat distance (LOWER = MORE DIFFERENT = BETTER) ────');
console.log('  Gap │ Pairs │ Avg shared Qs │ Avg same-pos Qs │ Avg copyability │ Worst case');
console.log('  ────┼───────┼───────────────┼─────────────────┼─────────────────┼───────────');
for (let gap = 1; gap <= 5; gap++) {
  const results = neighborResults.filter(r => r.gap === gap);
  const avgShared = (results.reduce((a, r) => a + r.selectionOverlapPct, 0) / results.length).toFixed(1);
  const avgPos = (results.reduce((a, r) => a + r.copyabilityPct, 0) / results.length).toFixed(2);
  const avgSharedCount = (results.reduce((a, r) => a + r.sharedCount, 0) / results.length).toFixed(1);
  const avgPosCount = (results.reduce((a, r) => a + r.positionMatches, 0) / results.length).toFixed(2);
  const worst = Math.max(...results.map(r => r.copyabilityPct)).toFixed(2);
  console.log(`    ${gap}  │  ${results.length.toString().padStart(3)}  │  ${avgSharedCount.padStart(5)} / 90 (${avgShared}%) │  ${avgPosCount.padStart(5)} / 90 (${avgPos.padStart(5)}%)  │       ${avgPos.padStart(5)}%       │   ${worst}%`);
}

// Worst individual pairs
console.log('\n─── Worst-case pairs (highest copyability among ±5 neighbors) ──────────');
const worst5 = neighborResults.sort((a, b) => b.copyabilityPct - a.copyabilityPct).slice(0, 5);
worst5.forEach(r => {
  console.log(`  Student #${r.studentA} vs #${r.studentB} (gap=${r.gap}): shared=${r.sharedCount}/90 questions, same-position=${r.positionMatches}/90 → copyability=${r.copyabilityPct.toFixed(2)}%`);
});

// Best-case (lowest copyability) among adjacent (gap=1)
console.log('\n─── Best-case gap=1 pairs (maximum paper difference) ────────────────────');
const gap1 = neighborResults.filter(r => r.gap === 1).sort((a, b) => a.copyabilityPct - b.copyabilityPct).slice(0, 5);
gap1.forEach(r => {
  console.log(`  Student #${r.studentA} vs #${r.studentB}: shared=${r.sharedCount}/90 questions, same-position=${r.positionMatches}/90 → copyability=${r.copyabilityPct.toFixed(2)}%`);
});

// Section breakdown for directly adjacent students (gap=1)
console.log('\n─── Section breakdown for adjacent students (gap=1, first 5 pairs) ─────');
const gap1First5 = neighborResults.filter(r => r.gap === 1).slice(0, 5);
for (const r of gap1First5) {
  console.log(`  Student #${r.studentA} vs #${r.studentB}:`);
  for (const sec of SECTIONS) {
    const ss = r.sectionStats[sec];
    console.log(`    ${sec.padEnd(10)}: shared=${ss.sharedCount}/${DELIVER_PER_SECTION} questions, same-position=${ss.positionMatches}/${DELIVER_PER_SECTION}`);
  }
}

// Visual similarity matrix for students 1-15 (gap=1 neighbors)
console.log('\n─── Copyability% matrix: Student pairs 1-20 (gap=1 neighbors) ──────────');
console.log('  Format: [A vs B]: copyability%  (same-position questions / 90)');
const gap1All = neighborResults.filter(r => r.gap === 1 && r.studentA <= 19).sort((a, b) => a.studentA - b.studentA);
gap1All.forEach(r => {
  const bar = '█'.repeat(Math.round(r.copyabilityPct / 2));
  const space = '░'.repeat(Math.round((20 - r.copyabilityPct) / 2));
  console.log(`  #${String(r.studentA).padStart(2)}↔#${String(r.studentB).padStart(2)}: ${r.copyabilityPct.toFixed(2).padStart(5)}%  ${bar}${space}`);
});

// Theoretical minimum overlap analysis
console.log('\n─── Theoretical analysis ────────────────────────────────────────────────');
const poolSize = QUESTIONS_PER_SECTION; // 40 per section
const deliverSize = DELIVER_PER_SECTION; // 30 per section
const step = selectionStepForPool(poolSize);
const theoreticalMinOverlap = Math.max(0, 2 * deliverSize - poolSize); // pigeonhole
const theoreticalMinOverlapPct = (theoreticalMinOverlap / deliverSize * 100).toFixed(1);
console.log(`  Pool per section:    ${poolSize} questions`);
console.log(`  Delivered per sec:   ${deliverSize} questions`);
console.log(`  Prime selection step: ${step} (displaces window by ~${step} positions)`);
console.log(`  Min guaranteed overlap per section: ${theoreticalMinOverlap}/${deliverSize} (${theoreticalMinOverlapPct}%) — pigeonhole bound`);
console.log(`  Even at minimum overlap, ORDER is shuffled deterministically → copy is useless`);

// Perturbation stats
const perturbUsed = papers.filter(p => p.usedPerturbation > 0).length;
console.log(`\n  Perturbation triggered: ${perturbUsed}/100 students`);

// Assertions
console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('   ASSERTIONS');
console.log('═══════════════════════════════════════════════════════════════════════');

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ PASS  ${name}`); }
  else { fail++; console.log(`  ❌ FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const gap1Results = neighborResults.filter(r => r.gap === 1);
const maxCopyGap1 = Math.max(...gap1Results.map(r => r.copyabilityPct));
const avgCopyGap1 = gap1Results.reduce((a, r) => a + r.copyabilityPct, 0) / gap1Results.length;

assert(`Adjacent (gap=1) avg copyability < 10%`, avgCopyGap1 < 10, `avg=${avgCopyGap1.toFixed(2)}%`);
assert(`Adjacent (gap=1) worst-case copyability < 15%`, maxCopyGap1 < 15, `max=${maxCopyGap1.toFixed(2)}%`);

// Check gap=1 is WORSE (more different) than random chance
// For 90 random questions from 120, random position collision = 90/90 * (1/90) * 90 = 1 expected collision = 1.1%
// Our algorithm should be close to or better than random
assert(`Adjacent students do NOT share position-identical question sets`, maxCopyGap1 < 20, `max=${maxCopyGap1.toFixed(2)}%`);

// Gap=5 should not be significantly better than gap=1 (distribution should be uniform)
const avgCopyGap5 = neighborResults.filter(r => r.gap === 5).reduce((a, r) => a + r.copyabilityPct, 0) / neighborResults.filter(r => r.gap === 5).length;
assert(`Gap=5 copyability is also low (< 10%)`, avgCopyGap5 < 10, `avg=${avgCopyGap5.toFixed(2)}%`);

// Every gap=1 pair should have DIFFERENT question selections
const gap1AllDiffSelection = gap1Results.every(r => r.sharedCount < 90);
assert(`All adjacent students have at least some different questions in their paper`, gap1AllDiffSelection);

// No gap=1 pair should have >50% of questions at the same position
const gap1NoneMonopoly = gap1Results.every(r => r.copyabilityPct < 50);
assert(`No adjacent pair has >50% questions at same position (would allow easy copying)`, gap1NoneMonopoly);

console.log(`\n  Result: ${pass} PASSED | ${fail} FAILED`);
console.log('═══════════════════════════════════════════════════════════════════════\n');

process.exit(fail > 0 ? 1 : 0);
