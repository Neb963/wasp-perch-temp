// Phase 2.4 parity harness (runs in page via page_eval {path}).
// Synthesizes 3 fixed scripts through the CURRENTLY READY engine and reports
// sample counts, wall/RTF, peak/RMS and SHA-256 of the PCM bytes.
// Run once per model (switch model, wait for ready, run again).
// Optional flow override for Full 2.5: set globalThis.SCL_FLOW = false before running.
const SCRIPTS = [
  'The lantern remained on the windowsill until sunrise.',
  'Mara whispered, but the corridor answered with nothing at all.',
  'Rain over the harbor, gulls, and a bell counting the hour.'
];
async function shaHex(u8){
  const d = await crypto.subtle.digest('SHA-256', u8);
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
const results = [];
for(const text of SCRIPTS){
  const req = {text, voice:'voice_1688', pace:1, guidance:1, level:'auto', default_controls:true};
  if(S.model==='full' && globalThis.SCL_FLOW===false) req.flow = false;
  if(S.model==='full') req.seed = 0;
  const r = await synthRequest(req);
  const pcm = r.pcm;
  let peak = 0, sum = 0;
  for(let i=0;i<pcm.length;i++){ const a=Math.abs(pcm[i]); if(a>peak)peak=a; sum+=pcm[i]*pcm[i]; }
  const rms = Math.sqrt(sum/Math.max(1,pcm.length));
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  results.push({
    model:S.model, flow:(req.flow===false?'off':'default'),
    chars:text.length, sampleCount:r.sampleCount,
    wallSec:+r.wallSec.toFixed(2), rtf:+(r.wallSec/(r.sampleCount/24000)).toFixed(2),
    peak:+peak.toFixed(3), rms:+rms.toFixed(3),
    sha256:(await shaHex(bytes)).slice(0,32)
  });
  log('test','parity '+S.model+' n='+r.sampleCount+' sha='+results[results.length-1].sha256);
}
return results;
