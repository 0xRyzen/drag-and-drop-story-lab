import { createHash } from 'node:crypto';
export const sha256 = x => createHash('sha256').update(x).digest('hex');
export const ALLOWED_TOOLS = new Set(['show_reference_elements','estimate_video_cost','generate_video','jobs_wait','media_upload','media_confirm']);
export function requireThat(ok, message) { if (!ok) throw new Error(message); }
export function validateRequest(r, op) {
  requireThat(op.allowed_repository && r.repository === op.allowed_repository, 'REPOSITORY_NOT_CONFIGURED_OR_NOT_ALLOWED');
  requireThat(r.branch === op.allowed_branch, 'BRANCH_NOT_ALLOWED');
  requireThat(/^[a-f0-9]{40}$/.test(r.commit || ''), 'IMMUTABLE_COMMIT_REQUIRED');
  requireThat(/^episodes\/season-\d{2}\/episode-\d{2}\.md$/.test(r.path || ''), 'INVALID_EPISODE_PATH');
  requireThat(op.allowed_episode_paths.includes(r.path), 'EPISODE_NOT_ENABLED_ON_SERVER');
  requireThat(['plan','render'].includes(r.mode), 'INVALID_MODE');
  if (r.mode === 'render') requireThat(op.render_enabled === true && op.max_credits_per_episode > 0, 'PAID_PRODUCTION_DISABLED');
  return r;
}
export function validateSettings(c) {
  for (const [k,v] of Object.entries({model:'minimax_h3',resolution:'2K',width:1440,height:2560,aspect_ratio:'9:16',clip_seconds:15,batch_size:1})) requireThat(c[k] === v, `SETTING_MISMATCH_${k}`);
  requireThat(JSON.stringify(c.episode_seconds) === '[60,75,90,105,120]', 'INVALID_EPISODE_DURATIONS');
  requireThat(Number.isInteger(c.max_retries_per_clip) && c.max_retries_per_clip >= 0 && c.max_retries_per_clip <= 2, 'INVALID_RETRY_LIMIT');
  requireThat(Number.isInteger(c.max_repair_jobs_per_episode) && c.max_repair_jobs_per_episode >= 0 && c.max_repair_jobs_per_episode <= 4, 'INVALID_EPISODE_REPAIR_LIMIT');
}
export function validateClip(c, settings, expectedIndex) {
  requireThat(c.clip_index === expectedIndex, 'CLIP_ORDER_INVALID');
  requireThat(JSON.stringify([...c.cast_tags].sort()) === JSON.stringify([...settings.allowed_characters].sort()), 'CAST_LOCK_INVALID');
  requireThat(new Set(c.cast_tags).size === c.cast_tags.length, 'DUPLICATE_CAST');
  requireThat(settings.allowed_locations.includes(c.location_tag), 'UNAPPROVED_LOCATION');
  requireThat(c.prop_tags.length <= 1 && c.prop_tags.every(t => settings.allowed_props.includes(t)), 'UNAPPROVED_PROP');
  requireThat(c.start_state && c.end_state && c.title, 'MISSING_CONTINUITY_STATE');
  requireThat(c.shots.length >= 3 && c.shots.length <= 5, 'INVALID_SHOT_COUNT');
  let end = 0, lineEnd = 0, words = 0;
  for (const s of c.shots) {
    requireThat(Number.isFinite(s.start) && Number.isFinite(s.end) && Math.abs(s.start - end) < 0.001 && s.end > s.start && s.end <= 15, 'SHOT_TIMELINE_GAP_OR_OVERLAP');
    requireThat(s.camera && s.action, 'EMPTY_SHOT_DIRECTION'); end = s.end;
    for (const d of s.dialogue) {
      requireThat(settings.voices[d.speaker] === d.voice_tag, 'VOICE_MAPPING_INVALID');
      requireThat(Number.isFinite(d.start) && Number.isFinite(d.end) && d.start >= s.start && d.end <= s.end && d.end > d.start && d.start >= lineEnd, 'DIALOGUE_TIMING_INVALID');
      const n = d.text.trim().split(/\s+/).filter(Boolean).length;
      requireThat(n > 0 && n / (d.end - d.start) <= 2.2, 'DIALOGUE_TOO_FAST');
      requireThat(!d.text.includes('\n'), 'DIALOGUE_MULTILINE');
      words += n; lineEnd = d.end;
    }
  }
  requireThat(Math.abs(end - 15) < 0.001 && words <= 30, 'INVALID_CLIP_DURATION_OR_WORD_BUDGET');
  requireThat(c.audio?.ambience?.trim() && c.audio?.music?.trim() && Array.isArray(c.audio.sfx), 'MISSING_AUDIO_DIRECTION');
  requireThat(c.audio.sfx.every(x => Number.isFinite(x.time) && x.time >= 0 && x.time < 15 && x.cue), 'INVALID_SFX_TIME');
  return words;
}
export function validatePlan(p, settings, hashes, episode) {
  requireThat(p.schema_version === 1 && p.season === episode.season && p.episode === episode.episode, 'EPISODE_ID_MISMATCH');
  requireThat(p.skill_sha256 === hashes.skill && p.story_sha256 === hashes.story, 'SOURCE_HASH_MISMATCH');
  requireThat(settings.episode_seconds.includes(p.duration_seconds) && p.clips.length * 15 === p.duration_seconds, 'EPISODE_DURATION_INVALID');
  const ids = p.beats.map(x => x.id), coverage = p.clips.flatMap(x => x.beat_ids);
  requireThat(ids.length >= 4 && new Set(ids).size === ids.length && ids.every(x => /^B\d{2}$/.test(x)), 'BEAT_IDS_INVALID');
  requireThat(JSON.stringify(ids) === JSON.stringify(coverage), 'BEAT_COVERAGE_REPEATED_MISSING_OR_REORDERED');
  const words = p.clips.reduce((n,c,i) => n + validateClip(c, settings, i + 1), 0);
  requireThat(words >= p.clips.length * 8, 'INSUFFICIENT_EPISODE_DIALOGUE');
  for (let i = 1; i < p.clips.length; i++) requireThat(p.clips[i].start_state === p.clips[i-1].end_state, 'PLANNED_CONTINUITY_MISMATCH');
  return p;
}
export function protectedClip(c) {
  return JSON.stringify({clip_index:c.clip_index,beat_ids:c.beat_ids,cast_tags:c.cast_tags,location_tag:c.location_tag,prop_tags:c.prop_tags,start_state:c.start_state,end_state:c.end_state,dialogue:c.shots.flatMap(s=>s.dialogue)});
}
export function compilePrompt(c, observedEnd = '') {
  const t = x => `0:${String(x).padStart(2,'0')}`;
  const lines = [`SCENE: ${c.title}`, 'DURATION: 15 seconds', 'ASPECT RATIO: 9:16',
    'STYLE: original 2D hand-drawn mystery-adventure cartoon, bold clean ink, flat cel shading, compact expressive characters, painterly atmospheric ruined server room, cold blue/red emergency light; no 3D CGI.',
    'CAST LOCK:', ...c.cast_tags.map(tag=>`- @${tag} = ${tag === 'jack-sheet' ? 'Jack' : 'Karega'}: exactly one physical instance, identity reference only.`),
    '- Exactly two physical people in the room. Cuts do not create new people. No duplicates, extra limbs or reflection copies.',
    `LOCATION: @${c.location_tag}. ${c.start_state}`, ...c.prop_tags.map(t=>`PROP: @${t}; exactly one existing physical object; preserve custody.`),
    'GEOMETRY: bodies remain fully outside solid equipment. Feet on the floor; exactly two connected arms and two hands per person. External control contact is allowed, body penetration is forbidden.',
    observedEnd ? `ACTUAL CONTINUITY: ${observedEnd}. The first image reference is the previous accepted final frame; preserve physical state, not a pasted still or frozen opening.` : 'OPENING: fresh establishing shot from the approved references, not a continuation from another episode.'];
  c.shots.forEach((s,i)=>{
    lines.push(`[${t(s.start)}-${t(s.end)}] ${i ? 'CUT TO: ' : ''}${s.camera}`,s.action);
    for(const d of s.dialogue) lines.push(`Dialogue [${t(d.start)}-${t(d.end)}] ${d.speaker}: "${d.text}" @${d.voice_tag}`);
  });
  lines.push(`AMBIENCE: ${c.audio.ambience}`, `ORIGINAL INSTRUMENTAL MUSIC: ${c.audio.music}`, ...c.audio.sfx.map(s=>`SFX @${s.time}s: ${s.cue}`),
    'AUDIO MIX: dialogue > motivated SFX > quiet original music. Native speech/lip sync; Jack Grady, Karega Arthur. Duck music under words. No lyrics, narrator or extra voice.',
    `END STATE: ${c.end_state}. Keep anatomy, floor contact and object separation correct through the last decoded frame.`);
  return lines.join('\n');
}
export function resolveElements(items, tags, approved = {}) {
  const out = {};
  for (const tag of tags) {
    const matches = items.filter(x=>x.name===tag && x.status==='completed');
    requireThat(matches.length === 1, `MISSING_OR_AMBIGUOUS_ELEMENT_${tag}`);
    const e = matches[0], pinned = approved[tag];
    if (pinned?.element_id) requireThat(e.id === pinned.element_id, `ELEMENT_ID_CHANGED_${tag}`);
    const medias = (e.medias || []).filter(x=> !pinned?.media_id || x.id === pinned.media_id);
    requireThat(medias.length === 1, `MISSING_OR_AMBIGUOUS_MEDIA_${tag}`);
    requireThat(/^[a-f0-9-]{36}$/i.test(medias[0].id), 'INVALID_IMAGE_MEDIA_ID');
    out[tag] = {element_id:e.id,media_id:medias[0].id,url:medias[0].url};
  }
  return out;
}
export function generationParams(c, bindings, prior) {
  const tags = [...c.cast_tags, ...(prior ? (c.prop_tags.length ? c.prop_tags : [c.location_tag]) : [c.location_tag,...c.prop_tags])];
  const medias = [...(prior ? [{value:prior.frame_id,role:'image'}] : []), ...tags.map(t=>({value:bindings[t].media_id,role:'image'}))];
  requireThat(medias.length >= 3 && medias.length <= 4 && medias.every(x=>x.value), 'REFERENCE_CAPACITY_OR_BINDING_FAILURE');
  return {model:'minimax_h3',prompt:compilePrompt(c,prior?.observed_end_state),duration:15,resolution:'2K',aspect_ratio:'9:16',batch_size:1,use_unlim:false,medias};
}
export function qaDisposition(q) {
  requireThat(typeof q.evidence_complete === 'boolean' && Array.isArray(q.hard_failures) && Array.isArray(q.warnings) && q.audio_fidelity === 'UNVERIFIED', 'INVALID_QA_RESULT');
  requireThat(typeof q.observed_end_state === 'string' && q.observed_end_state.trim(), 'QA_END_STATE_MISSING');
  requireThat(q.hard_failures.every(x => x.evidence && Number.isFinite(x.start) && Number.isFinite(x.end) && x.start >= 0 && x.end >= x.start && x.end <= 15), 'QA_FAILURE_EVIDENCE_INVALID');
  if (q.hard_failures.length) return 'FAIL';
  if (!q.evidence_complete) return 'REVIEW_REQUIRED';
  return q.warnings.length ? 'WARN' : 'PASS';
}
export function unwrap(x) {
  if (x.structuredContent) return x.structuredContent;
  if (x.result && typeof x.result === 'object') return x.result;
  for(const p of x.content || []) if(p.type==='text') { try { return JSON.parse(p.text); } catch {} }
  return x;
}
