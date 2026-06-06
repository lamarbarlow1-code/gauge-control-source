# Gauge Stack Controller — No Supabase Version

Use this version if you do not have Supabase keys.

This stays inside the existing GS&D Gauge Master Control app.

No new scattered app.
No Supabase.
No outside database keys.

Storage:
- Netlify Blobs
- Store name: gauge-stack-control
- Registry key: registry.json
- Proof key: proof-log.json
- Next actions key: next-actions.json

Required package:
- @netlify/blobs

Files to add:
- public/gauge-stack-controller.html
- public/gauge-stack-controller.css
- public/gauge-stack-controller.js
- netlify/functions/gauge-stack-agent.mts

Add this link inside the existing Master Control page:
<a href="/gauge-stack-controller.html">Open Gauge Stack Controller</a>

Then redeploy the same Netlify project:
gsd-gauge-master-control


Fixed deployment note:
- Runtime bug corrected: the function no longer references an undeclared Netlify global.
- Production custody option added: set GAUGE_OWNER_KEY in Netlify environment variables to protect POST sync/save actions.
- Frontend output escaping added before rendering registry values.
