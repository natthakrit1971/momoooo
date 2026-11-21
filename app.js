import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  setDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { libraryCategories, quizCategories, quizData } from "./data.js";

// Firebase Console > Project settings > Your apps: ค่า configuration ของโปรเจกต์นี้
const firebaseConfig = {
  apiKey: "AIzaSyB5Qql-yPxd5kQor2KfuMpIP7vnyMuFtCg",
  authDomain: "momoooo-web.firebaseapp.com",
  projectId: "momoooo-web",
  storageBucket: "momoooo-web.firebasestorage.app",
  messagingSenderId: "190893945083",
  appId: "1:190893945083:web:3609548b938ddeda05005e",
  measurementId: "G-XKCP0VZC7E"
};

const ADMIN_EMAIL = "nattakitnamo1971@gmail.com";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const provider = new GoogleAuthProvider();

const app = document.getElementById("app");
const modal = document.getElementById("contentModal");
const modalContent = document.getElementById("modalContent");
const toast = document.getElementById("toast");

let activeLibraryCategory = "ทั้งหมด";
let searchTerm = "";
let activeQuizCategory = "ธรณีวิทยา";
let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;
let quizFinished = false;
let quizCount = 5;
let isAdmin = false;
let contents = [];
let firestoreQuizQuestions = [];

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setView(view) {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === view);
  });
  document.getElementById("adminActions").hidden = !isAdmin;
  if (view === "library") renderLibrary();
  else generateQuizSet();
}

function subscribeFirestore() {
  onSnapshot(query(collection(db, "contents"), orderBy("createdAt", "desc")), (snapshot) => {
    contents = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    if (document.querySelector(".nav-tab.active")?.dataset.view === "library") renderLibrary();
  }, (error) => {
    console.error(error);
    showToast("เชื่อมต่อเนื้อหา Firestore ไม่สำเร็จ");
  });

  onSnapshot(collection(db, "quizzes"), (snapshot) => {
    firestoreQuizQuestions = snapshot.docs.map((item) => item.data()).filter((item) =>
      item.category && item.question && Array.isArray(item.choices) && item.choices.length >= 2
    );
  }, (error) => console.error(error));

  onSnapshot(doc(db, "settings", "announcement"), (snapshot) => {
    const message = snapshot.exists() ? String(snapshot.data().message || "").trim() : "";
    renderAnnouncement(message);
  }, (error) => console.error(error));
}

function renderAnnouncement(message) {
  const banner = document.getElementById("announcementBanner");
  const text = document.getElementById("announcementText");
  const adminActions = document.getElementById("announcementAdminActions");
  if (!banner || !text || !adminActions) return;

  if (message) {
    text.textContent = `📢 ข้อความฝากบอกจาก Admin: ${message}`;
    banner.hidden = false;
  } else {
    text.textContent = "";
    banner.hidden = true;
  }
  adminActions.hidden = !isAdmin;
}

function renderLibrary() {
  app.innerHTML = `
    <section>
      <div class="page-heading">
        <div>
          <span class="eyebrow">PASTEL CONTENT CLOUD</span>
          <h1>คลังชีทสรุป</h1>
        </div>
        <p>วิทยาศาสตร์โลกและอวกาศ 🌙</p>
      </div>
      <div class="controls">
        <div class="category-list" aria-label="หมวดหมู่เนื้อหา">
          ${libraryCategories.map((category) => `
            <button class="filter-button ${category === activeLibraryCategory ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">
              ${escapeHtml(category)}
            </button>
          `).join("")}
        </div>
        <label class="search-box">
          <span class="search-icon">⌕</span>
          <input id="searchInput" type="search" value="${escapeHtml(searchTerm)}" placeholder="ค้นหาชื่อเรื่อง..." aria-label="ค้นหาเนื้อหา">
        </label>
      </div>
      <div id="contentGrid" class="content-grid"></div>
    </section>
  `;

  renderContentCards();
  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      activeLibraryCategory = button.dataset.category;
      renderLibrary();
    });
  });
  document.getElementById("searchInput").addEventListener("input", (event) => {
    searchTerm = event.target.value.trim();
    renderContentCards();
  });
}

function renderContentCards() {
  const grid = document.getElementById("contentGrid");
  const filtered = contents.filter((item) => {
    const categoryMatch = activeLibraryCategory === "ทั้งหมด" || item.category === activeLibraryCategory;
    const searchMatch = String(item.title || "").toLowerCase().includes(searchTerm.toLowerCase());
    return categoryMatch && searchMatch;
  });

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">☁️</span>
        <h2>ยังไม่มีไฟล์เนื้อหาในขณะนี้</h2>
        <p>${isAdmin ? "กด + เพิ่มเนื้อหา เพื่อเติมข้อมูลให้ห้องเรียนของเรา" : "เดี๋ยวเจ้าของจะมาเติมเนื้อหาให้เร็วๆ นี้ ✿"}</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map((item) => `
    <article class="content-card" data-content-id="${escapeHtml(item.id)}" tabindex="0">
      <div class="card-ribbon"></div>
      <div class="category-icon">${categoryIcon(item.category)}</div>
      <span class="category-tag">${escapeHtml(item.category)}</span>
      <h2>${escapeHtml(item.title)}</h2>
      <p>${escapeHtml(item.description)}</p>
      ${isAdmin ? `<button class="delete-button" type="button" data-delete-id="${escapeHtml(item.id)}" title="ลบเนื้อหา" aria-label="ลบเนื้อหา">🗑️</button>` : ""}
    </article>
  `).join("");

  grid.querySelectorAll(".content-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (!event.target.closest(".delete-button")) openContentModal(card.dataset.contentId);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openContentModal(card.dataset.contentId);
    });
    addCardSpring(card);
  });
  grid.querySelectorAll(".delete-button").forEach((button) => {
    button.addEventListener("click", () => deleteContent(button.dataset.deleteId));
  });
}

function categoryIcon(category) {
  if (category === "ธรณีวิทยา") return "🏔️";
  if (category === "อุตุนิยมวิทยา") return "☁️";
  return "🪐";
}

function addCardSpring(card) {
  if (!matchMedia("(pointer:fine)").matches) return;
  card.addEventListener("pointermove", (event) => {
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rotateX = ((y / rect.height) - .5) * -5;
    const rotateY = ((x / rect.width) - .5) * 5;
    card.style.setProperty("--spot-x", `${x}px`);
    card.style.setProperty("--spot-y", `${y}px`);
    card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-7px)`;
  });
  card.addEventListener("pointerleave", () => { card.style.transform = ""; });
}

function openContentModal(id) {
  const item = contents.find((entry) => entry.id === id);
  if (!item) return;
  const sections = Array.isArray(item.sections) ? item.sections : [];
  modalContent.innerHTML = `
    <span class="category-tag">${escapeHtml(item.category)} ${categoryIcon(item.category)}</span>
    <h2 id="modalTitle">${escapeHtml(item.title)}</h2>
    <p class="detail-description">${escapeHtml(item.description)}</p>
    ${sections.length ? `
      <div class="detail-section">
        <span class="detail-label">หัวข้อสรุปย่อย ✿</span>
        <ul class="detail-list">${sections.map((section) => `<li>${escapeHtml(section)}</li>`).join("")}</ul>
      </div>
    ` : ""}
    ${item.driveLink ? `<a class="download-button" href="${escapeHtml(item.driveLink)}" target="_blank" rel="noopener noreferrer">เปิดไฟล์ / ดาวน์โหลด (Google Drive) ☁️</a>` : ""}
  `;
  openModal();
}

function openModal() {
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add("open"));
  document.body.style.overflow = "hidden";
  modal.querySelector("[data-close-modal]").focus();
}

function closeModal() {
  modal.classList.remove("open");
  modal.classList.add("closing");
  setTimeout(() => {
    modal.hidden = true;
    modal.classList.remove("closing");
    document.body.style.overflow = "";
  }, 180);
}

function openAddContentModal() {
  if (!isAdmin) return;
  modalContent.innerHTML = `
    <span class="eyebrow">ADMIN // เพิ่มเนื้อหาใหม่</span>
    <h2 id="modalTitle">เพิ่มเนื้อหาใหม่</h2>
    <form id="addContentForm" class="admin-form">
      <label>ชื่อเรื่อง <input name="title" maxlength="120" placeholder="เช่น ลำดับการตกผลึกโบเวน"></label>
      <label>หมวดหมู่
        <select name="category">
          ${quizCategories.map((category) => `<option value="${category}">${category}</option>`).join("")}
        </select>
      </label>
      <label>คำอธิบายสั้นๆ <textarea name="description" maxlength="260" rows="3"></textarea></label>
      <label>หัวข้อย่อย คั่นด้วยลูกน้ำ <input name="sections" placeholder="ทฤษฎี, สมบัติแร่, ตัวอย่างโจทย์"></label>
      <label>ลิงก์ Google Drive <input name="driveLink" type="url" placeholder="https://drive.google.com/..."></label>
      <button class="primary-button" type="submit">บันทึกลงคลัง ✨</button>
    </form>
  `;
  openModal();
  document.getElementById("addContentForm").addEventListener("submit", saveContent);
}

async function saveContent(event) {
  event.preventDefault();
  if (!isAdmin) return;
  const form = new FormData(event.currentTarget);
  const payload = {
    title: String(form.get("title") || "").trim() || "ไม่มีชื่อเรื่อง",
    category: String(form.get("category") || "ธรณีวิทยา"),
    description: String(form.get("description") || "").trim(),
    sections: String(form.get("sections") || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    driveLink: String(form.get("driveLink") || "").trim(),
    createdAt: serverTimestamp()
  };
  try {
    await addDoc(collection(db, "contents"), payload);
    closeModal();
    showToast("เพิ่มชีทเรียบร้อยแล้ว ✨");
  } catch (error) {
    console.error(error);
    showToast("บันทึกไม่สำเร็จ กรุณาตรวจสอบสิทธิ์ Firestore");
  }
}

async function deleteContent(id) {
  if (!isAdmin) return;
  if (!confirm("ลบเนื้อหานี้จริงไหมนะ?")) return;
  try {
    await deleteDoc(doc(db, "contents", id));
    showToast("ลบเนื้อหาเรียบร้อยแล้ว");
  } catch (error) {
    console.error(error);
    showToast("ลบเนื้อหาไม่สำเร็จ");
  }
}

function openAddQuizModal() {
  if (!isAdmin) return;
  modalContent.innerHTML = `
    <span class="eyebrow">ADMIN // เพิ่มโจทย์ควิซ</span>
    <h2 id="modalTitle">เพิ่มโจทย์ใหม่</h2>
    <form id="addQuizForm" class="admin-form">
      <label>หมวดหมู่
        <select name="category" required>
          ${quizCategories.map((category) => `<option value="${category}">${category}</option>`).join("")}
        </select>
      </label>
      <label>คำถาม <textarea name="question" required maxlength="300" rows="3"></textarea></label>
      <label>ตัวเลือก คั่นด้วยลูกน้ำ <input name="choices" required placeholder="ตัวเลือก 1, ตัวเลือก 2, ตัวเลือก 3, ตัวเลือก 4"></label>
      <label>คำตอบที่ถูก (เลข 1-4) <input name="answer" type="number" min="1" max="4" required></label>
      <label>คำอธิบายเฉลย <textarea name="explanation" required maxlength="500" rows="3"></textarea></label>
      <button class="primary-button" type="submit">เพิ่มโจทย์เข้าคลัง ✨</button>
    </form>
  `;
  openModal();
  document.getElementById("addQuizForm").addEventListener("submit", saveQuiz);
}

async function saveQuiz(event) {
  event.preventDefault();
  if (!isAdmin) return;
  const form = new FormData(event.currentTarget);
  const choices = String(form.get("choices")).split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  const payload = {
    category: String(form.get("category")),
    question: String(form.get("question")).trim(),
    choices,
    answer: Number(form.get("answer")) - 1,
    explanation: String(form.get("explanation")).trim(),
    createdAt: serverTimestamp()
  };
  if (choices.length !== 4 || payload.answer < 0 || payload.answer > 3 || !payload.question || !payload.explanation) {
    showToast("ต้องกรอกตัวเลือกให้ครบ 4 ข้อและเลือกคำตอบ 1-4");
    return;
  }
  try {
    await addDoc(collection(db, "quizzes"), payload);
    closeModal();
    showToast("เพิ่มโจทย์ควิซเรียบร้อยแล้ว 🌟");
  } catch (error) {
    console.error(error);
    showToast("เพิ่มโจทย์ไม่สำเร็จ");
  }
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function generateProceduralQuestions(category) {
  const generated = [];
  const integer = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  if (category === "ธรณีวิทยา") {
    const halfLife = [5, 10, 20, 50][integer(0, 3)];
    const elapsed = halfLife * [1, 2, 3][integer(0, 2)];
    const periods = elapsed / halfLife;
    const remaining = 100 / (2 ** periods);
    generated.push({
      question: `ไอโซโทปมีครึ่งชีวิต ${halfLife} ล้านปี ผ่านไป ${elapsed} ล้านปี จะเหลือกัมมันตภาพประมาณเท่าใด`,
      choices: [`${remaining}%`, `${remaining * 2}%`, `${remaining / 2}%`, "75%"],
      answer: 0,
      explanation: `ผ่านไป ${periods} ครึ่งชีวิต ดังนั้นเหลือ 100 × (1/2)^${periods} = ${remaining}%`
    });

    const epicenter = integer(30, 200);
    generated.push({
      question: `ขณะวัดคลื่นไหวสะเทือน แหล่งกำเนิดห่าง ${epicenter} km โดยคลื่น P ใช้เวลาก้าวผ่านลึกมากกว่าการ์ด ปรากฏการณ์ใดเป็น S-wave`,
      choices: ["เคลื่อนเฉือนและไม่ผ่านของเหลว", "เคลื่อนอัดขยายผ่านแก่นนอก", "เคลื่อนเฉพาะผิวโลก", "เคลื่อนผ่านแก๊สเท่านั้น"],
      answer: 0,
      explanation: "S-wave เป็นคลื่นเฉือน ไม่ผ่านของเหลวและเคลื่อนช้ากว่า P-wave"
    });
  } else if (category === "อุตุนิยมวิทยา") {
    const surface = integer(24, 32);
    const height = integer(1, 3);
    const dryTemp = surface - (9.8 * height);
    generated.push({
      question: `ถ้าอากาศแห้งบนพื้นอุณหภูมิ ${surface}°C ยกตัวขึ้น ${height} km อุณหภูมิประมาณเท่าใด`,
      choices: [`${dryTemp.toFixed(1)}°C`, `${(surface - 6.5 * height).toFixed(1)}°C`, `${(surface + height).toFixed(1)}°C`, "0°C"],
      answer: 0,
      explanation: `Dry adiabatic lapse rate ประมาณ 9.8°C/km จึงเป็น ${surface} − (9.8 × ${height}) = ${dryTemp.toFixed(1)}°C`
    });

    const temp = integer(28, 40);
    const dewPoint = temp - integer(4, 12);
    const lifting = integer(500, 2000);
    generated.push({
      question: `อากาศอุณหภูมิ ${temp}°C จุดน้ำค้าง ${dewPoint}°C ถูกยกตัวขึ้น ${lifting} m ควรยกขึ้นจนถึงระดับเมฆใกล้เท่าใด`,
      choices: ["100 m", `${lifting} m`, `${Math.round((temp - dewPoint) * 125)} m`, "10 km"],
      answer: 2,
      explanation: `ประมาณจุดน้ำค้างยกตัว 125 m ต่อการลดลง 1°C จึงอยู่ประมาณ ${(temp - dewPoint) * 125} m`
    });
  } else {
    const apparent = integer(-1, 8);
    const absolute = integer(-5, 3);
    const distance = 10 * (10 ** ((apparent - absolute) / 5));
    generated.push({
      question: `ดาวดวงหนึ่งมีโชติมาตรปรากฏ m = ${apparent} และสัมบูรณ์ M = ${absolute} ระยะห่างประมาณเท่าใด`,
      choices: [`${distance.toFixed(1)} pc`, `${(distance / 3.26).toFixed(1)} ly`, "10 pc", "1 pc"],
      answer: 0,
      explanation: `m − M = ${apparent - absolute}; d = 10 × 10^((m−M)/5) ≈ ${distance.toFixed(1)} pc`
    });

    const period = integer(2, 12);
    const semiMajor = period ** (2 / 3);
    generated.push({
      question: `วัตถุโคจรมีคาบโคจร ${period} ปี แกนกึ่งสำคัญจากกฎเคปเลอร์ข้อสามประมาณเท่าใด`,
      choices: [`${semiMajor.toFixed(2)} AU`, `${period} AU`, "1 AU", `${period ** 2} AU`],
      answer: 0,
      explanation: `P² = a³ จึง a = P^(2/3) = ${semiMajor.toFixed(2)} AU`
    });
  }

  return generated;
}

function generateQuizSet() {
  resetQuiz();
  app.innerHTML = `
    <section class="quiz-layout">
      <div class="page-heading">
        <div><span class="eyebrow">ENDLESS QUIZ CLOUD</span><h1>ควิซวิทโลก</h1></div>
        <p>สุ่มโจทย์ได้ไม่จำกัดเหมือนก้อนเมฆ ☁️</p>
      </div>
      <div class="quiz-controls">
        <div class="quiz-category-select" aria-label="หมวดหมู่ควิซ">
          ${quizCategories.map((category) => `
            <button class="${category === activeQuizCategory ? "active" : ""}" type="button" data-quiz-category="${escapeHtml(category)}">${category}</button>
          `).join("")}
        </div>
        <div class="count-select" aria-label="จำนวนข้อ">
          ${[5, 10, "∞"].map((count) => `
            <button class="${count === quizCount ? "active" : ""}" type="button" data-count="${count === "∞" ? "∞" : count}">${count} ข้อ</button>
          `).join("")}
          <button id="generateNewQuiz" class="generate-button" type="button">✦ สุ่มสร้างชุดใหม่</button>
        </div>
      </div>
      <div id="quizArea"></div>
    </section>
  `;

  document.querySelectorAll("[data-quiz-category]").forEach((button) => {
    button.addEventListener("click", () => {
      activeQuizCategory = button.dataset.quizCategory;
      resetQuiz();
      generateQuizSet();
    });
  });
  document.querySelectorAll("[data-count]").forEach((button) => {
    button.addEventListener("click", () => {
      quizCount = button.dataset.count === "∞" ? "∞" : Number(button.dataset.count);
      generateQuizSet();
    });
  });
  document.getElementById("generateNewQuiz").addEventListener("click", generateQuizSet);
  buildQuizQuestions();
  renderQuizQuestion();
}

function resetQuiz() {
  quizIndex = 0;
  quizScore = 0;
  quizAnswered = false;
  quizFinished = false;
}

function buildQuizQuestions() {
  const staticQuestions = shuffle(quizData[activeQuizCategory] || []);
  const firestoreQuestions = shuffle(firestoreQuizQuestions.filter((item) => item.category === activeQuizCategory));
  const proceduralQuestions = shuffle(generateProceduralQuestions(activeQuizCategory));
  const pool = shuffle([...staticQuestions, ...firestoreQuestions, ...proceduralQuestions]);
  const target = quizCount === "∞" ? 10 : quizCount;
  quizQuestions = [];

  while (quizQuestions.length < target) {
    quizQuestions.push(pool[quizQuestions.length % pool.length]);
  }
  quizQuestions = quizQuestions.map((item) => ({ ...item }));
}

function renderQuizQuestion() {
  const quizArea = document.getElementById("quizArea");
  if (!quizArea) return;

  if (quizFinished) {
    const total = quizQuestions.length;
    quizArea.innerHTML = `
      <div class="quiz-card result-card">
        <div class="score-cloud">☁️<span>${quizScore}/${total}</span><small>คะแนนที่ได้</small></div>
        <h2>ชุดควิซจบแล้วน้า 🌸</h2>
        <p>หมวด ${escapeHtml(activeQuizCategory)} · ตอบถูก ${quizScore} จาก ${total} ข้อ</p>
        <div class="result-actions">
          <button id="retryQuiz" class="primary-button" type="button">สุ่มชุดใหม่อีกที</button>
          <button id="backLibrary" class="secondary-button" type="button">ไปคลังชีท</button>
        </div>
      </div>
    `;
    document.getElementById("retryQuiz").addEventListener("click", generateQuizSet);
    document.getElementById("backLibrary").addEventListener("click", () => setView("library"));
    launchPastelCelebration();
    return;
  }

  const question = quizQuestions[quizIndex];
  const progress = ((quizIndex + 1) / quizQuestions.length) * 100;
  quizArea.innerHTML = `
    <div class="quiz-card">
      <div class="quiz-progress">
        <span>ข้อ ${quizIndex + 1} จาก ${quizQuestions.length}</span>
        <span>คะแนน <strong>${quizScore}</strong></span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
      <h2 class="question-title">${escapeHtml(question.question)}</h2>
      <div class="answer-list">
        ${question.choices.map((choice, index) => `
          <button class="answer-button" type="button" data-answer-index="${index}">
            <span class="answer-letter">${["ก","ข","ค","ง"][index]}</span>
            <span>${escapeHtml(choice)}</span>
          </button>
        `).join("")}
      </div>
      <div id="explanationArea"></div>
      <div class="quiz-actions">
        <button id="nextQuestion" class="primary-button" type="button" disabled>
          ${quizIndex === quizQuestions.length - 1 ? "ดูสรุปคะแนน" : "ข้อถัดไป"}
        </button>
      </div>
    </div>
  `;
  quizArea.querySelectorAll(".answer-button").forEach((button) => {
    button.addEventListener("click", () => answerQuestion(Number(button.dataset.answerIndex)));
  });
  document.getElementById("nextQuestion").addEventListener("click", nextQuestion);
}

function answerQuestion(selectedIndex) {
  if (quizAnswered) return;
  quizAnswered = true;
  const question = quizQuestions[quizIndex];
  const correct = selectedIndex === question.answer;
  document.querySelectorAll(".answer-button").forEach((button, index) => {
    button.disabled = true;
    if (index === question.answer) button.classList.add("correct");
    if (index === selectedIndex && !correct) button.classList.add("wrong");
  });
  if (correct) quizScore += 1;
  document.body.classList.add(correct ? "answer-success" : "answer-error");
  setTimeout(() => document.body.classList.remove("answer-success", "answer-error"), 520);
  document.getElementById("explanationArea").innerHTML = `
    <div class="explanation ${correct ? "correct" : "wrong"}">
      <strong>${correct ? "ถูกต้องจ้า! 🌟" : "ลองใหม่อีกนิดนะ 💗"}</strong>
      <span>${escapeHtml(question.explanation)}</span>
    </div>
  `;
  document.querySelector(".quiz-progress strong").textContent = quizScore;
  document.getElementById("nextQuestion").disabled = false;
}

function nextQuestion() {
  if (!quizAnswered) return;
  if (quizIndex < quizQuestions.length - 1) {
    quizIndex += 1;
    quizAnswered = false;
    renderQuizQuestion();
  } else {
    quizFinished = true;
    renderQuizQuestion();
  }
}

function launchPastelCelebration() {
  const symbols = ["✦", "★", "♥", "♡", "●"];
  const colors = ["#c084fc", "#7dd3fc", "#f9a8d4", "#c4b5fd", "#fef08a"];
  for (let i = 0; i < 58; i += 1) {
    const particle = document.createElement("span");
    particle.className = "celebration-particle";
    particle.textContent = symbols[i % symbols.length];
    particle.style.setProperty("--left", `${Math.random() * 100}vw`);
    particle.style.setProperty("--drift", `${(Math.random() - .5) * 260}px`);
    particle.style.setProperty("--color", colors[i % colors.length]);
    particle.style.animationDuration = `${2 + Math.random() * 1.8}s`;
    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 4000);
  }
}

function startAuroraCanvas() {
  const canvas = document.getElementById("auroraCanvas");
  const context = canvas.getContext("2d");
  let stars = [];
  let bubbles = [];
  let sparkles = [];
  let pointer = { x: innerWidth / 2, y: innerHeight / 2 };

  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    stars = Array.from({ length: Math.min(90, Math.floor(innerWidth / 12)) }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 2 + .5,
      speed: Math.random() * .006 + .002,
      phase: Math.random() * Math.PI * 2
    }));
    bubbles = Array.from({ length: 12 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 16 + 8,
      speed: Math.random() * .18 + .08
    }));
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (sparkles.length < 24) {
      sparkles.push({ x: event.clientX, y: event.clientY, life: 1, radius: Math.random() * 3 + 2 });
    }
  });

  function draw(time) {
    context.clearRect(0, 0, canvas.width, canvas.height);

    bubbles.forEach((bubble) => {
      bubble.y -= bubble.speed;
      if (bubble.y + bubble.radius < 0) bubble.y = canvas.height + bubble.radius;
      const shift = (pointer.x - canvas.width / 2) * .008;
      context.beginPath();
      context.fillStyle = "rgba(216,180,254,.10)";
      context.strokeStyle = "rgba(255,255,255,.28)";
      context.lineWidth = 1;
      context.arc(bubble.x + shift, bubble.y, bubble.radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });

    stars.forEach((star) => {
      const pulse = .35 + Math.abs(Math.sin(time * star.speed + star.phase)) * .65;
      context.beginPath();
      context.fillStyle = `rgba(192,132,252,${pulse * .75})`;
      context.arc(star.x + (pointer.x - canvas.width / 2) * .006, star.y, star.radius, 0, Math.PI * 2);
      context.fill();
    });

    sparkles = sparkles.filter((sparkle) => sparkle.life > 0);
    sparkles.forEach((sparkle) => {
      sparkle.life -= .035;
      context.beginPath();
      const visibleLife = Math.max(0, sparkle.life);
      context.fillStyle = `rgba(249,168,212,${visibleLife})`;
      context.arc(sparkle.x, sparkle.y, sparkle.radius * visibleLife, 0, Math.PI * 2);
      context.fill();
    });

    requestAnimationFrame(draw);
  }

  resize();
  requestAnimationFrame(draw);
}

async function handleLogin() {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    alert(error.code + " : " + error.message);
  }
}

async function handleLogout() {
  await signOut(auth);
  showToast("ออกจากระบบแล้ว");
}

async function saveAnnouncement() {
  if (!isAdmin) return;
  const currentText = document.getElementById("announcementText").textContent.replace(/^📢 ข้อความฝากบอกจาก Admin:\s*/, "");
  const message = prompt("พิมพ์ข้อความฝากบอกจาก Admin", currentText || "");
  if (message === null) return;
  const trimmed = message.trim();
  try {
    if (!trimmed) {
      await deleteDoc(doc(db, "settings", "announcement"));
      showToast("ลบข้อความฝากบอกแล้ว");
    } else {
      await setDoc(doc(db, "settings", "announcement"), { message: trimmed }, { merge: true });
      showToast("บันทึกข้อความฝากบอกแล้ว");
    }
  } catch (error) {
    console.error(error);
    showToast("บันทึกข้อความฝากบอกไม่สำเร็จ");
  }
}

async function deleteAnnouncement() {
  if (!isAdmin) return;
  if (!confirm("ต้องการลบข้อความฝากบอกนี้ใช่หรือไม่?")) return;
  try {
    await deleteDoc(doc(db, "settings", "announcement"));
    showToast("ลบข้อความฝากบอกแล้ว");
  } catch (error) {
    console.error(error);
    showToast("ลบข้อความฝากบอกไม่สำเร็จ");
  }
}

getRedirectResult(auth)
  .then((result) => {
    if (result?.user) {
      showToast("กำลังยืนยันสิทธิ์ผู้ดูแลระบบ...");
    }
  })
  .catch((error) => {
    console.error(error);
    showToast(error.code === "auth/popup-blocked"
      ? "เบราว์เซอร์ปิดหน้าล็อกอิน กรุณาลองอีกครั้ง"
      : "ล็อกอินด้วย Google ไม่สำเร็จ");
  });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    isAdmin = false;
  } else if (user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    isAdmin = true;
  } else {
    isAdmin = false;
    await signOut(auth);
    showToast("เฉพาะผู้ดูแลระบบเท่านั้น");
  }
  document.getElementById("adminBadge").hidden = !isAdmin;
  document.getElementById("adminActions").hidden = !isAdmin;
  document.getElementById("announcementAdminActions").hidden = !isAdmin;
  document.getElementById("loginButton").hidden = Boolean(user);
  document.getElementById("logoutButton").hidden = !isAdmin;
  if (document.querySelector(".nav-tab.active")?.dataset.view === "library") renderLibrary();
});

document.getElementById("homeBrand").addEventListener("click", () => setView("library"));
document.getElementById("libraryNav").addEventListener("click", () => setView("library"));
document.getElementById("quizNav").addEventListener("click", () => setView("quiz"));
document.getElementById("loginButton").addEventListener("click", handleLogin);
document.getElementById("logoutButton").addEventListener("click", handleLogout);
document.getElementById("addContentButton").addEventListener("click", openAddContentModal);
document.getElementById("addQuizButton").addEventListener("click", openAddQuizModal);
document.getElementById("addAnnouncementButton").addEventListener("click", saveAnnouncement);
document.getElementById("editAnnouncementButton").addEventListener("click", saveAnnouncement);
document.getElementById("deleteAnnouncementButton").addEventListener("click", deleteAnnouncement);
document.getElementById("copyEmailButton").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("nattakitnamo1971@gmail.com");
  } catch {
    const input = document.createElement("textarea");
    input.value = "nattakitnamo1971@gmail.com";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast("คัดลอกอีเมลแล้ว");
});
document.querySelector("[data-close-modal]").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) closeModal();
});

subscribeFirestore();
startAuroraCanvas();
renderLibrary();
