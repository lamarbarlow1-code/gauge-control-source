# GS&D Gauge Governor V1

Model-neutral control layer:

`Raw Input → Translator → Governor → Executor Adapter → Verifier → Proof Record → Approved Response`

V1 preserves original wording, creates structured control packets, blocks approval-gated side effects, rejects drift, and stores versioned proof records. Translator, executor, verifier, and proof storage remain separate.

## Run

```bash
npm install
cp .env.example .env
npm test
npm run build
npx netlify dev
```

The complete release package is maintained as `gsd-gauge-governor-v1.zip` in the build handoff. Deployment requires explicit owner approval.