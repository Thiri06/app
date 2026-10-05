# Burmese Subtitles

An authenticated, bring-your-own-key subtitle translator. Users register, save a Gemini or Grok key encrypted at rest, then translate uploaded SRT/VTT subtitle files.

## Stack

- React, TypeScript, and Vite for the editor
- Express and TypeScript for the API
- Node `crypto` for password hashing, signed sessions, and AES-256-GCM key encryption
- A local JSON store only for this first implementation; replace it with PostgreSQL/KMS before deployment

## Run locally

1. Copy `.env.example` to `.env` and set both secrets.
2. Run `npm install` from the repository root.
3. In separate terminals, run `npm run dev:api` and `npm run dev:web`.
4. Open `http://localhost:5173`, create an account, save one or more provider keys, and upload an SRT file.

## Security boundary

Keys never enter browser storage. They are posted over HTTPS to the API, encrypted using `KEY_ENCRYPTION_SECRET`, and decrypted only while making the provider request. The local JSON store is deliberately a development implementation. Production must use a managed database, KMS/secret envelope encryption, HTTPS, password-reset/email verification, rate limits, and object storage/job workers for video processing.

Gemini is called through its `generateContent` endpoint. Grok is called through xAI's OpenAI-compatible chat-completions endpoint. Model names are user-selectable so an administrator can update defaults without changing the provider abstraction.
