# Marginalia: PDF revision highlighter (pure JavaScript, Gemini)

    npm install
    npm start                              # then open http://localhost:3000

Put your settings in a `.env` file in the project folder:

    GEMINI_API_KEYS=key1,key2,key3         # tried in order; when one runs out of quota the next is used
    GEMINI_MODEL=gemini-3.5-flash          # optional

`GEMINI_API_KEY=key` (a single key) still works and can be combined with `GEMINI_API_KEYS`.
Run `node check-key.js` to test every key.

Using the app: choose a PDF, tick the pages you want highlighted (default: all), optionally type a topic
to focus on, then press Highlight. Pages you don't tick are never rendered, OCR'd or sent to Gemini.

Pipeline: textLayer / pdfToImages + ocrTool -> analyzer (Gemini, with key rotation) -> matcher -> highlighter -> server -> public UI.