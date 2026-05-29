import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '50mb' })); // 이미지 데이터를 받기 위해 페이로드 제한 증가

// OpenAI 클라이언트 초기화
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 시스템 프롬프트 로드
const systemPromptPath = path.join(__dirname, 'system_prompt.txt');
let systemPrompt = '';
try {
  systemPrompt = fs.readFileSync(systemPromptPath, 'utf8');
} catch (error) {
  console.warn('⚠️ system_prompt.txt 파일을 찾을 수 없습니다. 기본 프롬프트를 사용합니다.');
  systemPrompt = 'Analyze the dental image and return JSON format.';
}

/**
 * 0~100 점수(whiteness_score_100)를 ADBright 앱의 1~16 레벨로 변환하는 헬퍼 함수
 */
function mapScoreToLevel(score) {
  // 예시: 100점 만점을 16단계로 선형 스케일링
  // 필요에 따라 논문의 정확한 수식으로 교체하세요.
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  const level = Math.round((score / 100) * 15) + 1; 
  return Math.max(1, Math.min(16, level));
}

// 헬스 체크 엔드포인트
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', message: 'Clare Engine is running' });
});

// 메인 분석 엔드포인트
app.post('/api/v1/analyze', async (req, res) => {
  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: '이미지 데이터가 제공되지 않았습니다.' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OPENAI_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.' 
      });
    }

    // OpenAI Vision API 요청
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' }, // JSON 응답 강제
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image and return the JSON object as requested.' },
            {
              type: 'image_url',
              image_url: {
                url: image, // Base64 Data URL (예: data:image/jpeg;base64,/9j/4AAQ...)
              },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    // 결과 파싱
    const resultJsonStr = response.choices[0].message.content;
    const aiAnalysis = JSON.parse(resultJsonStr);

    // AI 결과에서 whiteness_score_100 추출 및 레벨 매핑
    const score = aiAnalysis?.metrics?.whiteness_score_100 || 80; // 추출 실패 시 기본값
    const finalLevel = mapScoreToLevel(score);

    // 프론트엔드로 응답 반환
    res.json({
      level: finalLevel,
      message: 'Analysis successful',
      rawAnalysis: aiAnalysis, // 디버깅용 원본 AI 응답 포함
    });

  } catch (error) {
    console.error('❌ 엔진 분석 오류:', error.message || error);
    res.status(500).json({ 
      error: '이미지 분석 중 서버 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// Vercel 환경에서는 app.listen 대신 export를 사용해야 합니다.
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Clare Engine server running on http://localhost:${PORT}`);
  });
}

export default app;
