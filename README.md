# Starklight

```
starklight-v2/
├── backend/       ← Express proxy (server.js + routes-execute.js) + the original single-page tool
└── starklight/    ← the Starklight React app
```

Both parts run together, in two terminals.

## 1. Backend

```bash
cd backend
npm install
node server.js          # -> http://localhost:3000
```

## 2. Frontend (separate terminal)

```bash
cd starklight
npm install
npm run dev             # -> http://localhost:5173
```

Open the printed URL and paste your Examly access token.

---

## Sections

| Section | What it does |
|---|---|
| 🛡️ **Test QC** | Open a published test, run the AI QC rubric section by section, get fixes, export Excel |
| 📋 **Manual Test Packing** | Build or edit a test — shared QB search, click-to-move, preview, publish |
| 🪄 **Smart Test Packer** | Describe each section and let it assemble the test automatically |
| 🔭 **Topic Analyser** | Check a test or QB against an allowed/restricted topic scope |
| ⚒️ **Solution Forge** | Add a solution in another language — generated, **actually compiled and run** against the question's real test cases, auto-fixed from real failures, then pushed |

---

## Solution Forge — toolchain requirement

Solution Forge verifies generated code by **running it locally**, so the relevant
compiler/interpreter must be installed and on `PATH`:

| Language | Needs |
|---|---|
| Python | `python` (or `python3`) |
| C | `gcc` |
| C++ | `g++` |
| Java / Java17 / Java21 | `javac` + `java` |

The Language step shows a live toolchain check, so anything missing is obvious
before you generate rather than looking like broken code.

If a toolchain is installed somewhere unusual (or you started the server before
installing it), point the backend at it:

```bash
# Windows
set EXTRA_TOOLCHAIN_PATHS=C:\msys64\mingw64\bin;C:\Program Files\Java\jdk-21\bin
# macOS / Linux
export EXTRA_TOOLCHAIN_PATHS=/opt/homebrew/bin:/usr/local/bin
```

Nothing is ever pushed to the portal unless it actually passed every test case.

---

## Troubleshooting

- **502 / `ECONNREFUSED`** → the backend isn't running, or isn't on port 3000.
- **"Cannot find module server.js"** → wrong folder; `server.js` is in `backend/`.
- **Solution Forge says a toolchain is missing** → install it, or set `EXTRA_TOOLCHAIN_PATHS` above.
