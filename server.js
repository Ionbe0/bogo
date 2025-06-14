const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const sqlite3 = require('sqlite3').verbose();
const vision = require('@google-cloud/vision');

// GCP 인증
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const client = new vision.ImageAnnotatorClient({
  keyFilename: 'imagesearch-462119-c34efd05462c.json', // 경로 확인
});

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../build')));

// 업로드 폴더 설정
const upload = multer({ dest: 'uploads/' });

// DB 초기화
const db = new sqlite3.Database('keywords.db');
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS image_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_name TEXT,
      keyword TEXT,
      confidence REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// 업로드 및 분석
app.post('/upload', upload.single('image'), async (req, res) => {
    const filePath = req.file.path;
    const fileName = req.file.originalname;

  try {
    const [result] = await client.labelDetection(filePath);
    const labels = result.labelAnnotations;
    const now = new Date().toISOString();

    const keywords = labels.map(label => ({
      keyword: label.description,
      confidence: Math.round(label.score * 100) / 100,
    }));

    // DB 저장
    const stmt = db.prepare("INSERT INTO image_keywords (image_name, keyword, confidence) VALUES (?, ?, ?)");
    keywords.forEach(k => stmt.run(fileName, k.keyword, k.confidence));
    stmt.finalize();

    const csvRecords = keywords.map(k => ({
    image_name: fileName,
    keyword: k.keyword,
    confidence: k.confidence,
    created_at: k.created_at,
    }));
    await csvWriter.writeRecords(csvRecords);

    res.json({
      message: '업로드 및 분석 성공',
      filename: fileName,
      keywords,
    });

    // 임시 파일 삭제
    fs.unlink(filePath, () => {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '분석 실패' });
  }
});

const csvWriter = createCsvWriter({
  path: 'keywords.csv',
  header: [
    { id: 'image_name', title: 'image_name' },
    { id: 'keyword', title: 'keyword' },
    { id: 'confidence', title: 'confidence' },
    { id: 'created_at', title: 'created_at' },
  ],
  append: fs.existsSync('keywords.csv'), // append mode if file exists
});

// 리액트 build index.html 서빙
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../build/index.html'));
});

app.listen(4000, () => {
  console.log('서버 실행 중: http://localhost:4000');
});
