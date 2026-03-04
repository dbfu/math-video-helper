import { parseFile } from 'music-metadata';
import { EdgeTTS } from 'node-edge-tts';

export async function createVoiceByText(text: string, path: string) {
  const tts = new EdgeTTS({
    voice: 'zh-CN-XiaoxiaoNeural',
  });
  await tts.ttsPromise(text, path);
}

export async function getMp3Duration(filePath: string): Promise<number> {
  const metadata = await parseFile(filePath);

  const duration = metadata.format.duration; // 秒
  return duration || 0;
}
