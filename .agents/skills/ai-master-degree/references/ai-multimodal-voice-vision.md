---
name: ai-multimodal-voice-vision
description: AI voice (speech-to-text, text-to-speech), vision/camera integration, multimodal AI, hearing, musical analysis, real-time audio/video with AI. How to add eyes and ears to AI apps.
---

# AI Multimodal: Voice, Vision, and Beyond

## Giving AI a Voice (TTS — Text-to-Speech)

### Best TTS Providers (2025)
| Provider | Quality | Latency | Cost | API |
|---|---|---|---|---|
| ElevenLabs | Best emotional range | 200-500ms | $0.30/1k chars | REST |
| OpenAI TTS | Very good, natural | 300ms | $0.015/1k chars | OpenAI SDK |
| Play.ht | Good, many voices | 400ms | $0.005/1k chars | REST |
| Cartesia | Great for real-time | <100ms | Low | WebSocket |
| Google Cloud TTS | Reliable, many languages | 200ms | $0.016/1k chars | GCP SDK |

### Streaming TTS (Real-Time)
Don't wait for the full AI response. Stream tokens to TTS as they arrive:

```typescript
// Server sends: token → TTS queue → audio chunks → client WebSocket
const ttsQueue: string[] = [];
let buffer = "";

onToken(token => {
  buffer += token;
  // Send to TTS when we hit a natural sentence break
  if (/[.!?]/.test(buffer) || buffer.length > 50) {
    ttsQueue.push(buffer);
    buffer = "";
    processTTSQueue();
  }
});
```

This reduces perceived latency from "wait for full response + TTS" to near-real-time audio.

### Sentence Boundary Chunking for Natural TTS
```typescript
function splitForTTS(text: string): string[] {
  // Split on sentence boundaries for natural delivery
  return text.match(/[^.!?]+[.!?]+/g) ?? [text];
}
```

### Voice Cloning
ElevenLabs and Play.ht allow voice cloning with ~30 seconds of audio. Use cases:
- Custom AI personas with unique voices
- User's own voice for their AI avatar
- Character voices for narrative AI apps

## Giving AI Ears (STT — Speech-to-Text)

### Best STT Providers (2025)
| Provider | Accuracy | Latency | Cost | Notes |
|---|---|---|---|---|
| OpenAI Whisper API | Excellent | 1-3s | $0.006/min | Best accuracy |
| Deepgram | Very good | Real-time | $0.008/min | Best for real-time |
| AssemblyAI | Good | Near real-time | $0.006/min | Good speaker diarization |
| Groq Whisper | Excellent | <0.5s | Very cheap | Fastest whisper inference |
| Browser Web Speech API | Okay | Real-time | Free | No server needed |

### Real-Time Transcription Architecture
```
Microphone → MediaRecorder (browser) → WebSocket → Server
→ Deepgram/AssemblyAI streaming API → transcript chunks
→ Send to LLM when silence detected → stream response back
→ TTS → audio back to client
```

### Voice Activity Detection (VAD)
Don't send audio constantly — detect when the user is speaking:
```typescript
// Browser VAD with Web Audio API
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
const rms = () => {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  return Math.sqrt(data.reduce((sum, x) => sum + x*x, 0) / data.length);
};
// If rms < 0.01 for 500ms: user has stopped speaking
```

### Whisper (Local) — Free Alternative
Run OpenAI's Whisper model locally for zero API cost:
```bash
pip install openai-whisper
whisper audio.mp3 --model base
```
Models: tiny (fastest, 39MB), base, small, medium, large (best quality, 1.5GB)
Use `faster-whisper` (CTranslate2 backend) for 4x speed improvement on CPU.

## Giving AI Eyes (Vision)

### Models with Vision (2025)
| Model | Best For | Cost |
|---|---|---|
| Grok-2-Vision | xAI ecosystem, balanced | ~$3/M tokens |
| GPT-4o | Best OCR, document analysis | $2.50/M tokens |
| Claude Sonnet 3.5 | Best at detailed image description | $3/M tokens |
| Gemini 1.5 Pro | Multi-image, video frames | $1.25/M tokens |
| Llava (open source) | Local deployment, basic vision | Free |

### Vision API Pattern
```typescript
const response = await client.chat.completions.create({
  model: "grok-2-vision",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What's in this image?" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }
    ]
  }]
});
```

### Camera Integration (Mobile — Expo)
```typescript
import { Camera } from "expo-camera";
import * as ImagePicker from "expo-image-picker";

// Take photo and send to vision model
const result = await ImagePicker.launchCameraAsync({ base64: true });
if (!result.canceled) {
  const base64 = result.assets[0].base64;
  const analysis = await callVisionModel(`data:image/jpeg;base64,${base64}`);
}
```

### Vision Use Cases for Your Apps
- **Document understanding**: Parse receipts, contracts, handwritten notes
- **Screenshot analysis**: Analyze user's screen for context
- **Product recognition**: Identify products in photos
- **Medical imaging**: (Requires specific compliance — HIPAA etc.)
- **Accessibility**: Describe images for visually impaired users
- **Real-time context**: "What am I looking at?" queries

## AI + Music (Hearing Musical Structure)

### Audio Analysis APIs
- **Essentia** (open source): Extract tempo, key, mode, energy, danceability
- **Spotify Web API**: Detailed audio features for tracks in Spotify catalog
- **ACRCloud**: Music recognition (like Shazam), free tier available
- **Spleeter** (open source): Separate stems (vocals, drums, bass)

### Musical Analysis with AI
```typescript
// Send audio features as context to LLM
const features = await analyzeAudio(audioFile);
const response = await model.chat([{
  role: "user",
  content: `Analyze this music: BPM=${features.tempo}, Key=${features.key}, 
  Energy=${features.energy}, Danceability=${features.danceability}. 
  What genre? What mood? What's it good for?`
}]);
```

### Real-Time Music Understanding
```
Browser → Web Audio API → FFT analysis → frequency data
→ Beat detection → musical features → LLM context
→ AI generates commentary, suggests next tracks, etc.
```

## The Multimodal Future

### What's Coming (12-24 months)
- **Real-time voice**: Sub-100ms latency voice AI (GPT-4o real-time, Gemini Live already exist)
- **Video understanding**: Frame-by-frame video analysis at reasonable cost
- **Embodied AI**: Camera + microphone + actuators = robots with LLM brains (early but real)
- **Native multimodal**: Models that natively process audio, video, text without conversion

### Building for the Multimodal Future
- Abstract your media handling: don't couple audio processing to your UI
- Store raw media references, not just transcriptions — you'll want to reprocess with better models
- Design for modality agnosticism: users should be able to type, speak, or send images interchangeably
- Accessibility win: multimodal IS accessible — voice for those who can't type, vision for those who can't see

## Voice + AI Integration in This Stack

### Current Stack (Memory Machine)
Currently text-only. Voice integration path:

**Web:**
1. Browser MediaRecorder API → WAV chunks
2. POST to `/api/voice/transcribe` → Whisper/Deepgram
3. Transcript → existing `/api/threads/:id/stream` (existing)
4. Streamed response → ElevenLabs TTS → audio chunks → client

**Mobile (Expo):**
1. `expo-av` for recording
2. `expo-file-system` to upload audio chunk
3. Server transcribes → existing stream endpoint
4. Response → `expo-av` for playback

The existing SSE streaming infrastructure is already voice-ready — just needs audio I/O wrappers.

### Cost for Voice Features
- Whisper (Groq): ~$0.001/minute of audio (extremely cheap)
- ElevenLabs TTS: ~$0.30/1,000 characters ≈ $0.05/response
- Round trip cost: ~$0.06 per voice exchange (vs. ~$0.05 for text-only with Grok-3)

Voice adds minimal marginal cost. The user experience uplift is enormous.
