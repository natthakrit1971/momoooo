const categories = ["ธรณีวิทยา", "อุตุนิยมวิทยา", "ดาราศาสตร์"];
const difficulties = ["ง่าย", "ปานกลาง", "ยาก"];
const forbiddenOutputTerms = /ค่าย\s*[12]|ผู้แทน/;

const systemPrompt = `
คุณเป็นผู้แต่งข้อสอบวิทยาศาสตร์โลกและอวกาศระดับโอลิมปิกวิชาการ
สร้างข้อสอบปรนัยภาษาไทย 4 ตัวเลือก ให้ถูกต้องทางวิทยาศาสตร์ ไม่ซ้ำซาก
และระดับความลึกต้องตรงตามระดับที่ผู้ใช้ระบุ:
- ง่าย: พื้นฐานระดับเริ่มต้น ครอบคลุมโครงสร้างโลก แร่และหิน
  องค์ประกอบบรรยากาศ สมดุลพลังงาน ระบบสุริยะ และทรงกลมท้องฟ้า
- ปานกลาง: วิเคราะห์และคำนวณเชิงลึกในธรณีโครงสร้าง แผ่นธรณีภาค
  อุณหพลศาสตร์บรรยากาศ อัตราการลดอุณหภูมิตามความสูง กฎเคปเลอร์
  โชติมาตร และแผนภาพ H-R
- ยาก: วิเคราะห์และคำนวณซับซ้อนเกี่ยวกับคลื่นไหวสะเทือน
  แม่เหล็กบรรพกาล ลมจีโอสโทรฟิก แรงคอริออลิส กฎของวีน
  กฎสเตฟาน-โบลต์ซมันน์ และวิวัฒนาการดาว
ห้ามใช้คำว่า "ค่าย 1", "ค่าย 2" หรือ "ผู้แทน" ในโจทย์ ตัวเลือก หรือคำอธิบาย
ตรวจสอบว่ามีคำตอบถูกต้องเพียงข้อเดียว และเฉลยอธิบายหลักการพร้อมวิธีคิดที่ตรวจสอบได้
ตอบเป็น JSON Array เท่านั้น แต่ละรายการต้องมีรูปแบบ:
{"question":"...","choices":["...","...","...","..."],"answer":0,
"explanation":"หลักการ: ...\\nวิธีคิด: ...\\nศัพท์สำคัญ: ... (English Scientific Term)"}
answer ต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 3 และ explanation ต้องมีคำศัพท์วิชาการภาษาอังกฤษ
หลังคำว่า ศัพท์สำคัญ: ทุกข้อ ห้ามมีข้อความอื่นนอกเหนือจาก JSON Array
`;

function isValidQuestion(question) {
  if (!question || typeof question !== "object" || Array.isArray(question)) return false;
  if (typeof question.question !== "string" || !question.question.trim()) return false;
  if (!Array.isArray(question.choices) || question.choices.length !== 4) return false;
  if (!question.choices.every((choice) => typeof choice === "string" && choice.trim())) return false;
  if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer > 3) return false;
  if (typeof question.explanation !== "string") return false;
  if (!question.explanation.startsWith("หลักการ:") ||
      !question.explanation.includes("\nวิธีคิด:") ||
      !question.explanation.includes("\nศัพท์สำคัญ:") ||
      !/[A-Za-z]/.test(question.explanation.slice(question.explanation.lastIndexOf("\nศัพท์สำคัญ:")))) {
    return false;
  }
  return ![question.question, ...question.choices, question.explanation]
    .some((value) => forbiddenOutputTerms.test(value));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const { category, difficulty, count } = body || {};
  if (!categories.includes(category) || !difficulties.includes(difficulty) ||
      !Number.isInteger(count) || count < 1 || count > 20) {
    return res.status(400).json({ error: "Invalid quiz request" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Quiz generation is not configured" });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{
            role: "user",
            parts: [{
              text: `สร้างข้อสอบหมวด ${category} ระดับ ${difficulty} จำนวน ${count} ข้อพอดี`
            }]
          }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    if (!response.ok) {
      console.error("Gemini quiz generation failed with status", response.status);
      return res.status(502).json({ error: "Quiz generation failed" });
    }

    const result = await response.json();
    const generatedText = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    const questions = JSON.parse(generatedText);
    if (!Array.isArray(questions) || questions.length !== count ||
        !questions.every(isValidQuestion)) {
      return res.status(502).json({ error: "Generated quiz had an invalid format" });
    }

    return res.status(200).json(questions.map((question) => ({
      question: question.question.trim(),
      choices: question.choices.map((choice) => choice.trim()),
      answer: question.answer,
      explanation: question.explanation.trim()
    })));
  } catch (error) {
    console.error("Gemini quiz generation request failed", error);
    return res.status(502).json({ error: "Quiz generation failed" });
  }
}
