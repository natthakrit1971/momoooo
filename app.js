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
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  limit,
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
const quizDifficulties = ["ง่าย", "ปานกลาง", "ยาก"];

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
let activeQuizDifficulty = "ง่าย";
let quizBuildGeneration = 0;
let quizBuildController = null;
let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;
let quizFinished = false;
let quizCount = 5;
let quizTotalQuestions = 0;
let quizSetScore = 0;
let quizResultSaved = false;
let currentCombo = 0;
let maxCombo = 0;
let isMistakeReviewMode = false;
let isAdmin = false;
let currentUser = null;
let playerDisplayName = "";
let contents = [];
let firestoreQuizQuestions = [];
let siteStats = {};
let leaderboardUnsubscribe = null;
const viewedInSession = new Set();

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inferScientificTerms(question, explanation) {
  const englishTerms = `${question} ${explanation}`.match(/\b[A-Z][A-Za-z]+(?:[- ][A-Za-z]+)*\b/g) || [];
  return [...new Set(englishTerms)].slice(0, 4).join(", ") || "หลักการทางวิทยาศาสตร์ (Core Scientific Principle)";
}

function explanationParts(question) {
  const explanation = String(question.explanation || "");
  const parts = explanation.split(/\nศัพท์สำคัญ:\s*/);
  return {
    body: parts[0],
    terms: question.keyTerms || parts[1] || inferScientificTerms(question.question || "", explanation)
  };
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
  if (view === "library") {
    quizBuildGeneration += 1;
    if (quizBuildController) {
      quizBuildController.abort();
      quizBuildController = null;
    }
    if (leaderboardUnsubscribe) {
      leaderboardUnsubscribe();
      leaderboardUnsubscribe = null;
    }
    renderLibrary();
  } else {
    generateQuizSet();
  }
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

  onSnapshot(doc(db, "settings", "stats"), (snapshot) => {
    siteStats = snapshot.exists() ? snapshot.data() : {};
    if (isAdmin && document.querySelector(".nav-tab.active")?.dataset.view === "library") renderLibrary();
  }, (error) => console.error(error));
}

function recordPageView(user) {
  if (sessionStorage.getItem("visited_momoooo")) return;
  sessionStorage.setItem("visited_momoooo", "true");
  if (user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return;
  setDoc(doc(db, "settings", "stats"), { pageViews: increment(1) }, { merge: true })
    .catch((error) => {
      sessionStorage.removeItem("visited_momoooo");
      console.error(error);
      showToast("บันทึกสถิติการเข้าชมไม่สำเร็จ");
    });
}

function totalContentViews() {
  return contents.reduce((total, item) => total + (Number(item.views) || 0), 0);
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
      <div class="page-heading library-heading">
        <h1>คลังชีทสรุป</h1>
      </div>
      ${isAdmin ? `
        <div class="stats-summary" aria-label="สถิติเข้าเว็บและเปิดไฟล์">
          <div><span>🌐 ยอดเข้าชมเว็บทั้งหมด</span><strong>${Number(siteStats.pageViews) || 0}</strong></div>
          <div><span>📚 ยอดเปิดไฟล์รวมทุกเรื่อง</span><strong>${totalContentViews()}</strong></div>
        </div>
      ` : ""}
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
      ${isAdmin ? `<span class="content-views">👁️ เปิดดู ${Number(item.views) || 0} ครั้ง</span>` : ""}
      ${isAdmin ? `
        <button class="edit-button" type="button" data-edit-id="${escapeHtml(item.id)}" title="แก้ไขเนื้อหา" aria-label="แก้ไขเนื้อหา">✏️</button>
        <button class="delete-button" type="button" data-delete-id="${escapeHtml(item.id)}" title="ลบเนื้อหา" aria-label="ลบเนื้อหา">🗑️</button>
      ` : ""}
    </article>
  `).join("");

  grid.querySelectorAll(".content-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (!event.target.closest(".delete-button, .edit-button")) openContentModal(card.dataset.contentId);
    });
    card.addEventListener("keydown", (event) => {
      if (event.target !== card) return;
      if (event.key === "Enter" || event.key === " ") openContentModal(card.dataset.contentId);
    });
    addCardSpring(card);
  });
  grid.querySelectorAll(".delete-button").forEach((button) => {
    button.addEventListener("click", () => deleteContent(button.dataset.deleteId));
  });
  grid.querySelectorAll(".edit-button").forEach((button) => {
    button.addEventListener("click", () => openEditContentModal(button.dataset.editId));
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
  if (!isAdmin && auth.currentUser?.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    incrementContentViews(id);
  }
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

async function incrementContentViews(id) {
  if (viewedInSession.has(id)) return;
  viewedInSession.add(id);
  try {
    await updateDoc(doc(db, "contents", id), { views: increment(1) });
  } catch (error) {
    viewedInSession.delete(id);
    console.error(error);
    showToast("บันทึกสถิติการเปิดไฟล์ไม่สำเร็จ");
  }
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

function openEditContentModal(id) {
  if (!isAdmin) return;
  const item = contents.find((entry) => entry.id === id);
  if (!item) {
    showToast("ไม่พบเนื้อหาที่ต้องการแก้ไข");
    return;
  }

  const sections = Array.isArray(item.sections) ? item.sections.join(", ") : "";
  modalContent.innerHTML = `
    <span class="eyebrow">ADMIN // แก้ไขเนื้อหา</span>
    <h2 id="modalTitle">แก้ไขเนื้อหา</h2>
    <form id="editContentForm" class="admin-form">
      <label>ชื่อเรื่อง <input name="title" maxlength="120" value="${escapeHtml(item.title || "")}" placeholder="เช่น ลำดับการตกผลึกโบเวน"></label>
      <label>หมวดหมู่
        <select name="category">
          ${quizCategories.map((category) => `
            <option value="${category}" ${item.category === category ? "selected" : ""}>${category}</option>
          `).join("")}
        </select>
      </label>
      <label>คำอธิบายสั้นๆ <textarea name="description" maxlength="260" rows="3">${escapeHtml(item.description || "")}</textarea></label>
      <label>หัวข้อย่อย คั่นด้วยลูกน้ำ <input name="sections" value="${escapeHtml(sections)}" placeholder="ทฤษฎี, สมบัติแร่, ตัวอย่างโจทย์"></label>
      <label>ลิงก์ Google Drive <input name="driveLink" type="url" value="${escapeHtml(item.driveLink || "")}" placeholder="https://drive.google.com/..."></label>
      <button class="primary-button" type="submit">บันทึกการแก้ไข ✨</button>
    </form>
  `;
  openModal();
  document.getElementById("editContentForm").addEventListener("submit", (event) => updateContent(event, id));
}

async function updateContent(event, id) {
  event.preventDefault();
  if (!isAdmin) return;
  const form = new FormData(event.currentTarget);
  const payload = {
    title: String(form.get("title") || "").trim() || "ไม่มีชื่อเรื่อง",
    category: String(form.get("category") || "ธรณีวิทยา"),
    description: String(form.get("description") || "").trim(),
    sections: String(form.get("sections") || "").split(/[,，]/).map((section) => section.trim()).filter(Boolean),
    driveLink: String(form.get("driveLink") || "").trim(),
    updatedAt: serverTimestamp()
  };

  try {
    await updateDoc(doc(db, "contents", id), payload);
    closeModal();
    showToast("แก้ไขเนื้อหาเรียบร้อยแล้ว ✨");
  } catch (error) {
    console.error(error);
    showToast("แก้ไขเนื้อหาไม่สำเร็จ");
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
      <label>ระดับความยาก
        <select name="difficulty" required>
          ${quizDifficulties.map((difficulty) => `<option value="${difficulty}">${difficulty}</option>`).join("")}
        </select>
      </label>
      <label>คำถาม <textarea name="question" required maxlength="300" rows="3"></textarea></label>
      <label>ตัวเลือก คั่นด้วยลูกน้ำ <input name="choices" required placeholder="ตัวเลือก 1, ตัวเลือก 2, ตัวเลือก 3, ตัวเลือก 4"></label>
      <label>คำตอบที่ถูก (เลข 1-4) <input name="answer" type="number" min="1" max="4" required></label>
      <label>คำอธิบายเฉลย <textarea name="explanation" required maxlength="500" rows="3" placeholder="อธิบายหลักการและวิธีคิด"></textarea></label>
      <label>ศัพท์สำคัญ (ภาษาอังกฤษ) <input name="keyTerms" placeholder="เช่น แรงคอริออลิส (Coriolis Force)"></label>
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
  const question = String(form.get("question")).trim();
  const explanation = String(form.get("explanation")).trim();
  const keyTerms = String(form.get("keyTerms") || "").trim();
  const completeExplanation = /(?:^|\n)ศัพท์สำคัญ:/u.test(explanation)
    ? explanation
    : `${explanation}\nศัพท์สำคัญ: ${keyTerms || inferScientificTerms(question, explanation)}`;
  const payload = {
    category: String(form.get("category")),
    difficulty: String(form.get("difficulty") || "ง่าย"),
    question,
    choices,
    answer: Number(form.get("answer")) - 1,
    explanation: completeExplanation,
    keyTerms,
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

function generateProceduralQuestions(category, difficulty) {
  const generated = [];
  const integer = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const addQuestion = (question, choices, answer, principle, method, terms) => {
    generated.push({
      category,
      difficulty,
      question,
      choices,
      answer,
      explanation: `หลักการ: ${principle}\nวิธีคิด: ${method}\nศัพท์สำคัญ: ${terms}`
    });
  };

  if (category === "ธรณีวิทยา" && difficulty === "ง่าย") {
    const halfLife = [5, 10, 20, 50][integer(0, 3)];
    const periods = integer(1, 3);
    const elapsed = halfLife * periods;
    const remaining = 100 / (2 ** periods);
    const remainingChoices = periods === 1
      ? [remaining, 100, 25, 75]
      : periods === 2
        ? [remaining, 50, 12.5, 75]
        : [remaining, 25, 6.25, 50];
    addQuestion(
      `ไอโซโทปกัมมันตรังสีมีครึ่งชีวิต ${halfLife} ล้านปี เมื่อผ่านไป ${elapsed} ล้านปี จะเหลือไอโซโทปร้อยละเท่าใด`,
      remainingChoices.map((choice) => `${choice}%`),
      0,
      "ทุกหนึ่งครึ่งชีวิต จำนวนไอโซโทปแม่จะลดลงเหลือครึ่งหนึ่งของจำนวนก่อนหน้า",
      `เวลาที่ผ่านไปเท่ากับ ${periods} ครึ่งชีวิต จึงคำนวณสัดส่วนคงเหลือด้วย (1/2)^${periods} = ${remaining}%`,
      "การหาอายุด้วยไอโซโทปรังสี (Radiometric Dating), ครึ่งชีวิต (Half-life)"
    );
    const mineral = ["ควอตซ์", "ยิปซัม", "แคลไซต์"][integer(0, 2)];
    const hardness = { "ควอตซ์": 7, "ยิปซัม": 2, "แคลไซต์": 3 }[mineral];
    addQuestion(
      `แร่${mineral}มีความแข็ง ${hardness} ตามมาตราโมส์ แร่ชนิดใดมีโอกาสขูดแร่ดังกล่าวเป็นรอย`,
      ["แร่ที่มีความแข็งต่ำกว่าเท่านั้น", "แร่ที่มีความแข็งสูงกว่า", "แร่ทุกชนิดที่มีสีเข้มกว่า", "แร่ที่มีความถ่วงจำเพาะต่ำกว่า"],
      1,
      "มาตราโมส์จัดลำดับความแข็งจากความสามารถในการขูดกัน โดยแร่ที่แข็งกว่าจะทำให้แร่ที่อ่อนกว่าเป็นรอย",
      `แร่${mineral}มีค่าความแข็ง ${hardness} ดังนั้นแร่ที่มีค่ามากกว่า ${hardness} จึงขูดให้เป็นรอยได้ สีและความถ่วงจำเพาะไม่ใช่เกณฑ์นี้`,
      "ความแข็งของแร่ (Mineral Hardness), มาตราโมส์ (Mohs Scale)"
    );
  } else if (category === "ธรณีวิทยา" && difficulty === "ปานกลาง") {
    const speed = integer(2, 6);
    const years = integer(2, 5);
    const distance = speed * years * 10;
    addQuestion(
      `แผ่นธรณีภาคเคลื่อนที่ ${speed} cm/ปี เป็นเวลา ${years} ล้านปี จะเคลื่อนที่รวมประมาณกี่กิโลเมตร`,
      [`${distance} km`, `${distance * 10} km`, `${distance / 10} km`, `${speed + years} km`],
      0,
      "การเคลื่อนที่ของแผ่นธรณีภาคคำนวณจากอัตราเร็วคูณเวลา และต้องแปลงหน่วยเซนติเมตรกับปีให้สอดคล้อง",
      `${speed} cm/ปี × ${years} ล้านปี = ${speed * years} ล้าน cm; เนื่องจาก 1 km = 100,000 cm จึงเท่ากับ ${distance} km`,
      "การแปรสัณฐานแผ่นธรณีภาค (Plate Tectonics), อัตราการแผ่ขยายพื้นมหาสมุทร (Spreading Rate)"
    );
    addQuestion(
      "ชั้นหินสองข้างของระนาบรอยเลื่อนเลื่อนสวนทางกันในแนวราบเป็นหลัก จัดเป็นโครงสร้างใด",
      ["รอยเลื่อนปกติ (Normal Fault)", "รอยเลื่อนย้อน (Reverse Fault)", "รอยเลื่อนตามแนวระดับ (Strike-slip Fault)", "รอยคดโค้ง (Fold)"],
      2,
      "ชนิดรอยเลื่อนจำแนกจากทิศการเคลื่อนที่สัมพัทธ์ของมวลหิน โดยการเลื่อนในแนวระดับเกิดจากแรงเฉือน",
      "เมื่อการกระจัดหลักขนานกับแนวระนาบพื้นผิวและไม่ใช่การยกหรือทรุดเด่นชัด จัดเป็นรอยเลื่อนตามแนวระดับ",
      "การเลื่อนแบบเฉือนตามแนวระดับ (Strike-slip Fault), แรงเฉือน (Shear Stress)"
    );
  } else if (category === "ธรณีวิทยา" && difficulty === "ยาก") {
    const vp = 8;
    const vs = 4;
    const difference = integer(6, 12);
    const distance = difference / (1 / vs - 1 / vp);
    addQuestion(
      `สถานีตรวจวัดพบเวลามาถึงของคลื่น S ช้ากว่าคลื่น P ${difference} s หากสมมติ Vp = ${vp} km/s และ Vs = ${vs} km/s ระยะถึงแหล่งกำเนิดประมาณเท่าใด`,
      [`${distance} km`, `${(difference * 4).toFixed(0)} km`, `${(difference * 12).toFixed(0)} km`, `${(difference * 2).toFixed(0)} km`],
      0,
      "คลื่น P เดินทางเร็วกว่า S จึงเกิดช่วงเวลามาถึงต่างกัน (S–P time) ซึ่งใช้ประมาณระยะจากสถานีถึงแหล่งกำเนิดได้",
      `ให้ระยะเป็น d: Δt = d(1/Vs − 1/Vp) ดังนั้น d = ${difference}/(1/${vs} − 1/${vp}) = ${distance} km โดยสมมติความเร็วคงที่`,
      "เวลา S–P (S–P Time), คลื่นปฐมภูมิ (P-wave), คลื่นทุติยภูมิ (S-wave), การระบุตำแหน่งแผ่นดินไหว (Earthquake Location)"
    );
    const inclination = 45;
    const paleolatitude = Math.atan(Math.tan(inclination * Math.PI / 180) / 2) * 180 / Math.PI;
    addQuestion(
      `หินภูเขาไฟโบราณบันทึกมุมเอียงสนามแม่เหล็ก ${inclination}° ใกล้เส้นศูนย์สูตร โดย tan(I) = 2 tan(λ) ละติจูดแม่เหล็กโบราณ λ มีค่าประมาณเท่าใด`,
      [`${paleolatitude.toFixed(0)}°`, "45°", "90°", "0°"],
      0,
      "ทิศเอียงของสนามแม่เหล็กที่ถูกบันทึกในหินสัมพันธ์กับละติจูดที่หินก่อตัว ภายใต้แบบจำลองสนามไดโพลแกนกลาง",
      `จัดรูปเป็น tan(λ) = tan(I)/2 แล้วแทน I = ${inclination}° จะได้ λ ≈ ${paleolatitude.toFixed(0)}°; ค่านี้ใช้อนุมานตำแหน่งละติจูดเดิม`,
      "แม่เหล็กบรรพกาล (Paleomagnetism), ละติจูดแม่เหล็กโบราณ (Paleolatitude), สนามไดโพลแกนกลาง (Geocentric Axial Dipole)"
    );
  } else if (category === "อุตุนิยมวิทยา" && difficulty === "ง่าย") {
    const albedo = [0.2, 0.3, 0.4][integer(0, 2)];
    const incoming = 100;
    const absorbed = incoming * (1 - albedo);
    addQuestion(
      `พื้นผิวรับรังสีดวงอาทิตย์ ${incoming} หน่วย และมีอัลบีโด ${albedo} จะดูดกลืนพลังงานได้กี่หน่วย`,
      [`${absorbed} หน่วย`, `${incoming * albedo} หน่วย`, `${incoming + incoming * albedo} หน่วย`, `${incoming / albedo} หน่วย`],
      0,
      "อัลบีโดคือสัดส่วนรังสีที่สะท้อนกลับ พลังงานที่ดูดกลืนจึงเป็นพลังงานขาเข้าคูณส่วนที่ไม่สะท้อน",
      `พลังงานดูดกลืน = ${incoming} × (1 − ${albedo}) = ${absorbed} หน่วย`,
      "อัลบีโด (Albedo), สมดุลพลังงานโลก (Earth Energy Balance), รังสีคลื่นสั้น (Shortwave Radiation)"
    );
    const height = integer(1, 3);
    const temperature = 30 - 6.5 * height;
    addQuestion(
      `ใช้ค่าอัตราการลดอุณหภูมิบรรยากาศเฉลี่ย 6.5°C/km หากอุณหภูมิพื้นผิว 30°C ที่ระดับสูง ${height} km จะประมาณกี่องศาเซลเซียส`,
      [`${temperature.toFixed(1)}°C`, `${(30 + 6.5 * height).toFixed(1)}°C`, "30°C", "6.5°C"],
      0,
      "อุณหภูมิโดยทั่วไปลดลงเมื่อระดับสูงขึ้นในโทรโพสเฟียร์ โดยค่าเฉลี่ยสิ่งแวดล้อมใช้ประมาณ 6.5°C ต่อกิโลเมตร",
      `T ≈ 30 − (6.5 × ${height}) = ${temperature.toFixed(1)}°C; เป็นค่าประมาณเฉลี่ย ไม่ใช่อัตราอะเดียแบติกของก้อนอากาศ`,
      "อัตราการลดอุณหภูมิตามความสูงของบรรยากาศ (Environmental Lapse Rate), โทรโพสเฟียร์ (Troposphere)"
    );
  } else if (category === "อุตุนิยมวิทยา" && difficulty === "ปานกลาง") {
    const surface = integer(26, 34);
    const rise = integer(1, 3);
    const parcelTemp = surface - 9.8 * rise;
    const environmentTemp = surface - 6.5 * rise;
    addQuestion(
      `อากาศไม่อิ่มตัวยกจากพื้น ${surface}°C ขึ้น ${rise} km; ใช้ DALR = 9.8°C/km และ ELR = 6.5°C/km สภาพเสถียรภาพเป็นอย่างไร`,
      ["ไม่เสถียร เพราะก้อนอากาศอุ่นกว่า", "เสถียร เพราะก้อนอากาศเย็นกว่าอากาศแวดล้อม", "เป็นกลาง เพราะอุณหภูมิเท่ากัน", "สรุปไม่ได้แม้ทราบอัตราลดอุณหภูมิ"],
      1,
      "ประเมินเสถียรภาพโดยเปรียบเทียบอุณหภูมิก้อนอากาศที่ยกตัวกับสิ่งแวดล้อม ณ ระดับเดียวกัน",
      `ก้อนอากาศมี T = ${parcelTemp.toFixed(1)}°C ส่วนสิ่งแวดล้อมมี T = ${environmentTemp.toFixed(1)}°C; ก้อนอากาศเย็นกว่าและมีความหนาแน่นมากกว่า จึงมีแนวโน้มจมกลับ`,
      "เสถียรภาพบรรยากาศ (Atmospheric Stability), อัตราอะเดียแบติกแห้ง (Dry Adiabatic Lapse Rate), อัตราการลดอุณหภูมิสิ่งแวดล้อม (Environmental Lapse Rate)"
    );
    const dewPointDepression = integer(4, 12);
    const lcl = 125 * dewPointDepression;
    addQuestion(
      `อุณหภูมิอากาศกับจุดน้ำค้างต่างกัน ${dewPointDepression}°C ประมาณระดับยกตัวควบแน่น (LCL) อยู่สูงจากจุดเริ่มกี่เมตร`,
      [`${lcl} m`, `${lcl + 375} m`, `${lcl - 250} m`, `${lcl * 2} m`],
      0,
      "ก้อนอากาศที่ยกตัวแบบไม่อิ่มตัวจะเย็นลงและเข้าใกล้จุดอิ่มตัว จนเริ่มเกิดการควบแน่นที่ LCL",
      `ใช้ค่าประมาณ 125 m ต่อความต่างอุณหภูมิ 1°C: LCL ≈ 125 × ${dewPointDepression} = ${lcl} m`,
      "ระดับยกตัวควบแน่น (Lifting Condensation Level), จุดน้ำค้าง (Dew Point), การยกตัวแบบอะเดียแบติก (Adiabatic Ascent)"
    );
  } else if (category === "อุตุนิยมวิทยา" && difficulty === "ยาก") {
    const latitude = [30, 45, 60][integer(0, 2)];
    const omega = 7.292e-5;
    const coriolis = 2 * omega * Math.sin(latitude * Math.PI / 180);
    const density = 1.2;
    const pressureGradient = 0.01;
    const wind = pressureGradient / (density * coriolis);
    addQuestion(
      `ที่ละติจูด ${latitude}° ใช้ ρ = ${density} kg/m³ และความชันความกดอากาศ 0.01 Pa/m คำนวณความเร็วลมจีโอสโทรฟิกโดยประมาณ`,
      [`${wind.toFixed(1)} m/s`, `${(wind * 2).toFixed(1)} m/s`, `${(wind / 10).toFixed(1)} m/s`, "0 m/s"],
      0,
      "เมื่อลมระดับบนอยู่ในสมดุล แรงความกดอากาศเกรเดียนต์ถูกหักล้างด้วยแรงคอริออลิส และลมพัดเกือบขนานเส้นไอโซบาร์",
      `คำนวณ f = 2Ωsinφ = ${coriolis.toExponential(2)} s⁻¹ แล้วใช้ Vg = |∇p|/(ρf) = 0.01/(${density} × ${coriolis.toExponential(2)}) ≈ ${wind.toFixed(1)} m/s`,
      "ลมจีโอสโทรฟิก (Geostrophic Wind), พารามิเตอร์คอริออลิส (Coriolis Parameter), แรงเกรเดียนต์ความกดอากาศ (Pressure-Gradient Force)"
    );
    const deltaPressure = integer(4, 8);
    const spacing = integer(200, 400);
    const gradient = (deltaPressure * 100) / (spacing * 1000);
    addQuestion(
      `แผนที่อากาศมีความกดต่างกัน ${deltaPressure} hPa ในระยะ ${spacing} km จงหาขนาดความชันความกดอากาศเฉลี่ย`,
      [`${gradient.toFixed(4)} Pa/m`, `${(gradient * 1000).toFixed(2)} Pa/m`, `${deltaPressure * spacing} Pa/m`, "0 Pa/m"],
      0,
      "ความชันความกดอากาศคือการเปลี่ยนความกดต่อระยะทาง โดยทิศชี้จากความกดต่ำไปสูง",
      `แปลง ${deltaPressure} hPa = ${deltaPressure * 100} Pa และ ${spacing} km = ${spacing * 1000} m; ดังนั้น |∇p| = Δp/Δx = ${gradient.toFixed(4)} Pa/m`,
      "อุตุนิยมวิทยาซินอปติก (Synoptic Meteorology), ความชันความกดอากาศ (Pressure Gradient), แผนที่ไอโซบาร์ (Isobaric Map)"
    );
  } else if (category === "ดาราศาสตร์" && difficulty === "ง่าย") {
    const parallax = [0.2, 0.5, 1, 2][integer(0, 3)];
    const distance = 1 / parallax;
    addQuestion(
      `ดาวมีพารัลแลกซ์ ${parallax} พิลิปดา ระยะทางประมาณกี่พาร์เซก`,
      [`${distance} pc`, `${parallax} pc`, `${(distance * 3.26).toFixed(2)} pc`, "10 pc"],
      0,
      "การเลื่อนตำแหน่งปรากฏของดาวใกล้เมื่อโลกเปลี่ยนตำแหน่งใช้วัดพารัลแลกซ์ และระยะทางแปรผกผันกับมุมดังกล่าว",
      `ใช้ d(pc) = 1/p(arcsec) ดังนั้น d = 1/${parallax} = ${distance} pc`,
      "พารัลแลกซ์ดาวฤกษ์ (Stellar Parallax), พาร์เซก (Parsec), การเคลื่อนที่ปรากฏ (Apparent Motion)"
    );
    const moonPhase = integer(1, 4);
    const phaseNames = ["จันทร์เสี้ยวข้างขึ้น", "จันทร์ครึ่งดวงข้างขึ้น", "จันทร์เกือบเต็มดวง", "จันทร์เต็มดวง"];
    addQuestion(
      `เมื่อดวงจันทร์อยู่ห่างจากดวงอาทิตย์บนทรงกลมท้องฟ้าประมาณ ${[45, 90, 135, 180][moonPhase - 1]}° จะเห็นเฟสใดโดยประมาณ`,
      [phaseNames[(moonPhase + 1) % 4], phaseNames[moonPhase - 1], "จันทร์ดับเสมอ", "ขึ้นพร้อมดวงอาทิตย์เสมอ"],
      1,
      "เฟสดวงจันทร์เกิดจากสัดส่วนด้านสว่างที่หันเข้าหาผู้สังเกตเปลี่ยนไปตามตำแหน่งสัมพันธ์ของดวงอาทิตย์ โลก และดวงจันทร์",
      "มุมห่าง (elongation) ประมาณ 45°, 90°, 135° และ 180° สอดคล้องโดยประมาณกับเสี้ยวข้างขึ้น ครึ่งดวงข้างขึ้น เกือบเต็มดวง และเต็มดวงตามลำดับ",
      "เฟสดวงจันทร์ (Lunar Phase), มุมห่าง (Elongation), ทรงกลมท้องฟ้า (Celestial Sphere)"
    );
  } else if (category === "ดาราศาสตร์" && difficulty === "ปานกลาง") {
    const semiMajor = integer(2, 8);
    const period = Math.sqrt(semiMajor ** 3);
    addQuestion(
      `วัตถุโคจรรอบดาวฤกษ์มวลหนึ่งหน่วยมีแกนกึ่งเอก ${semiMajor} AU คาบโคจรประมาณกี่ปี`,
      [`${period.toFixed(1)} ปี`, `${semiMajor ** 2} ปี`, `${semiMajor} ปี`, `${(semiMajor / 2).toFixed(1)} ปี`],
      0,
      "กฎเคปเลอร์ข้อสามสำหรับระบบที่มวลศูนย์กลางเท่าดวงอาทิตย์เชื่อมคาบโคจรกับแกนกึ่งเอก",
      `ใช้ P² = a³ เมื่อ a = ${semiMajor} AU จะได้ P = √(${semiMajor}³) = ${period.toFixed(1)} ปี`,
      "กฎเคปเลอร์ข้อสาม (Kepler's Third Law), คาบโคจร (Orbital Period), แกนกึ่งเอก (Semi-major Axis)"
    );
    const distance = integer(20, 200);
    const modulus = 5 * Math.log10(distance / 10);
    addQuestion(
      `ดาวอยู่ห่าง ${distance} pc และมีโชติมาตรสัมบูรณ์ M = 2 โชติมาตรปรากฏ m มีค่าประมาณเท่าใด`,
      [`${(2 + modulus).toFixed(1)}`, `${(2 - modulus).toFixed(1)}`, `${(distance / 10).toFixed(1)}`, `${(2 + distance).toFixed(1)}`],
      0,
      "โชติมาตรปรากฏขึ้นกับทั้งกำลังส่องสว่างแท้จริงและระยะทาง โดยระยะทางมากขึ้นทำให้วัตถุดูจางลง",
      `Distance Modulus ให้ m − M = 5log10(d/10); แทน d = ${distance} pc ได้ m = 2 + ${modulus.toFixed(2)} ≈ ${(2 + modulus).toFixed(1)}`,
      "โชติมาตรสัมบูรณ์ (Absolute Magnitude), โชติมาตรปรากฏ (Apparent Magnitude), มอดูลัสระยะทาง (Distance Modulus)"
    );
  } else {
    const temperature = integer(4000, 9000);
    const wavelength = 2.898e-3 / temperature;
    addQuestion(
      `ดาวฤกษ์มีอุณหภูมิผิว ${temperature} K ตามกฎของวีน จุดสูงสุดของการแผ่รังสีอยู่ที่ความยาวคลื่นประมาณเท่าใด`,
      [`${(wavelength * 1e9).toFixed(0)} nm`, `${(wavelength * 1e6).toFixed(2)} μm`, `${temperature} nm`, "2.898 nm"],
      0,
      "สเปกตรัมวัตถุดำของดาวมีความยาวคลื่นที่แผ่พลังงานสูงสุดแปรผกผันกับอุณหภูมิผิว",
      `ใช้ λmax T = 2.898 × 10⁻³ m·K; λmax = 2.898 × 10⁻³/${temperature} = ${(wavelength * 1e9).toFixed(0)} nm`,
      "กฎการกระจัดของวีน (Wien's Displacement Law), วัตถุดำ (Blackbody), ความยาวคลื่นสูงสุด (Peak Wavelength)"
    );
    const radiusRatio = integer(2, 5);
    const temperatureRatio = 2;
    const luminosityRatio = radiusRatio ** 2 * temperatureRatio ** 4;
    addQuestion(
      `ดาว A มีรัศมีเป็น ${radiusRatio} เท่าและอุณหภูมิผิวเป็น ${temperatureRatio} เท่าของดาว B อัตราส่วนความส่องสว่าง LA/LB เป็นเท่าใด`,
      [`${luminosityRatio}`, `${radiusRatio * temperatureRatio}`, `${radiusRatio ** 2}`, `${temperatureRatio ** 2}`],
      0,
      "กำลังส่องสว่างของดาวทรงกลมสัมพันธ์กับพื้นที่ผิวและกำลังสี่ของอุณหภูมิสัมบูรณ์",
      `จาก L = 4πR²σT⁴ ได้ LA/LB = (${radiusRatio})²(${temperatureRatio})⁴ = ${luminosityRatio}`,
      "กฎสเตฟาน–โบลต์ซมันน์ (Stefan–Boltzmann Law), ความส่องสว่าง (Luminosity), อุณหภูมิยังผล (Effective Temperature)"
    );
  }

  return generated;
}

async function generateQuizSet() {
  isMistakeReviewMode = false;
  resetQuiz();
  if (leaderboardUnsubscribe) leaderboardUnsubscribe();
  const mistakes = getMistakeNotebook();
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
        <div class="quiz-difficulty-select" aria-label="เลือกระดับความยาก">
          ${quizDifficulties.map((difficulty) => `
            <button class="${difficulty === activeQuizDifficulty ? "active" : ""}" type="button" data-quiz-difficulty="${difficulty}">${difficulty}</button>
          `).join("")}
        </div>
        <div class="count-select" aria-label="จำนวนข้อ">
          ${[5, 10, "∞"].map((count) => `
            <button class="${count === quizCount ? "active" : ""}" type="button" data-count="${count === "∞" ? "∞" : count}">${count} ข้อ</button>
          `).join("")}
          <button id="generateNewQuiz" class="generate-button" type="button">✦ สุ่มสร้างชุดใหม่</button>
          <button id="reviewMistakesBtn" class="mistake-button" type="button" ${mistakes.length === 0 ? "disabled" : ""}>🩹 ทวนข้อที่เคยตอบผิด (${mistakes.length})</button>
        </div>
      </div>
      <div id="quizArea"></div>
      <section id="leaderboard" class="leaderboard-card" aria-live="polite"></section>
    </section>
  `;

  document.querySelectorAll("[data-quiz-category]").forEach((button) => {
    button.addEventListener("click", () => {
      activeQuizCategory = button.dataset.quizCategory;
      resetQuiz();
      generateQuizSet();
    });
  });
  document.querySelectorAll("[data-quiz-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      activeQuizDifficulty = button.dataset.quizDifficulty;
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
  document.getElementById("reviewMistakesBtn").addEventListener("click", startMistakeReview);
  subscribeLeaderboard();
  if (await buildQuizQuestions()) renderQuizQuestion();
}

function resetQuiz() {
  quizIndex = 0;
  quizScore = 0;
  quizSetScore = 0;
  quizTotalQuestions = 0;
  quizAnswered = false;
  quizFinished = false;
  quizResultSaved = false;
  currentCombo = 0;
  maxCombo = 0;
}

const mistakeNotebookKey = "momoooo_mistake_notebook";

function isValidMistakeQuestion(question) {
  return question &&
    typeof question.question === "string" &&
    question.question.trim() &&
    Array.isArray(question.choices) &&
    question.choices.length === 4 &&
    question.choices.every((choice) => typeof choice === "string") &&
    Number.isInteger(question.answer) &&
    question.answer >= 0 &&
    question.answer <= 3 &&
    typeof question.explanation === "string";
}

function getMistakeNotebook() {
  try {
    const saved = localStorage.getItem(mistakeNotebookKey);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      console.error("Mistake notebook data is not an array");
      return [];
    }
    return parsed.filter(isValidMistakeQuestion);
  } catch (error) {
    console.error("Could not read mistake notebook", error);
    return [];
  }
}

function saveToMistakeNotebook(question) {
  const mistakes = getMistakeNotebook();
  if (mistakes.some((item) => item.question === question.question)) return;
  const savedQuestion = {
    question: question.question,
    choices: [...question.choices],
    answer: question.answer,
    explanation: question.explanation,
    category: question.category || activeQuizCategory,
    difficulty: question.difficulty || activeQuizDifficulty
  };
  try {
    localStorage.setItem(mistakeNotebookKey, JSON.stringify([...mistakes, savedQuestion]));
  } catch (error) {
    console.error("Could not save question to mistake notebook", error);
    showToast("บันทึกข้อผิดพลาดไม่สำเร็จ");
  }
}

function removeFromMistakeNotebook(questionText) {
  const mistakes = getMistakeNotebook();
  const remaining = mistakes.filter((question) => question.question !== questionText);
  if (remaining.length === mistakes.length) return false;
  try {
    localStorage.setItem(mistakeNotebookKey, JSON.stringify(remaining));
    return true;
  } catch (error) {
    console.error("Could not remove question from mistake notebook", error);
    showToast("อัปเดตสมุดข้อผิดไม่สำเร็จ");
    return false;
  }
}

function updateReviewMistakesButton() {
  const button = document.getElementById("reviewMistakesBtn");
  if (!button) return;
  const mistakes = getMistakeNotebook();
  button.textContent = `🩹 ทวนข้อที่เคยตอบผิด (${mistakes.length})`;
  button.disabled = mistakes.length === 0;
}

function startMistakeReview() {
  const mistakes = getMistakeNotebook();
  if (!mistakes.length) {
    updateReviewMistakesButton();
    return;
  }
  resetQuiz();
  isMistakeReviewMode = true;
  quizQuestions = shuffle(mistakes).map((question) => ({ ...question }));
  quizTotalQuestions = quizQuestions.length;
  renderQuizQuestion();
}

function setQuizControlsDisabled(disabled) {
  document.querySelectorAll(".quiz-controls button").forEach((button) => {
    button.disabled = disabled;
  });
  if (!disabled) updateReviewMistakesButton();
}

function showQuizLoading() {
  const quizArea = document.getElementById("quizArea");
  if (!quizArea) return;
  quizArea.innerHTML = `
    <div class="quiz-card quiz-loading" role="status" aria-live="polite">
      <span class="quiz-loading-cloud" aria-hidden="true">☁️</span>
      <p>กำลังสร้างชุดข้อสอบสดใหม่ด้วย AI...</p>
    </div>
  `;
}

function buildLocalQuizQuestions(target) {
  const staticQuestions = shuffle(quizData[activeQuizCategory] || []);
  const firestoreQuestions = shuffle(firestoreQuizQuestions.filter((item) =>
    item.category === activeQuizCategory && (item.difficulty || "ง่าย") === activeQuizDifficulty
  ));
  const proceduralQuestions = shuffle(generateProceduralQuestions(activeQuizCategory, activeQuizDifficulty));
  const matchingStaticQuestions = staticQuestions.filter((item) =>
    (item.difficulty || "ง่าย") === activeQuizDifficulty
  );
  const pool = shuffle([...matchingStaticQuestions, ...firestoreQuestions, ...proceduralQuestions]);
  if (!pool.length) throw new Error("No local quiz questions available");

  const questions = [];
  while (questions.length < target) {
    questions.push(pool[questions.length % pool.length]);
  }
  return questions;
}

function isValidGeneratedQuiz(questions, target) {
  return Array.isArray(questions) &&
    questions.length === target &&
    questions.every((question) =>
      question &&
      typeof question.question === "string" &&
      question.question.trim() &&
      Array.isArray(question.choices) &&
      question.choices.length === 4 &&
      question.choices.every((choice) => typeof choice === "string" && choice.trim()) &&
      Number.isInteger(question.answer) &&
      question.answer >= 0 &&
      question.answer <= 3 &&
      typeof question.explanation === "string" &&
      question.explanation.startsWith("หลักการ:") &&
      question.explanation.includes("\nวิธีคิด:") &&
      question.explanation.includes("\nศัพท์สำคัญ:")
    );
}

async function buildQuizQuestions() {
  const generation = ++quizBuildGeneration;
  if (quizBuildController) quizBuildController.abort();
  const controller = new AbortController();
  quizBuildController = controller;
  const target = quizCount === "∞" ? 20 : quizCount;
  let timeoutId;
  let questions;

  setQuizControlsDisabled(true);
  showQuizLoading();
  try {
    timeoutId = setTimeout(() => controller.abort(), 18000);
    const response = await fetch("/api/generate-quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: activeQuizCategory,
        difficulty: activeQuizDifficulty,
        count: target
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Quiz API returned ${response.status}`);
    const generatedQuestions = await response.json();
    if (!isValidGeneratedQuiz(generatedQuestions, target)) {
      throw new Error("Quiz API returned an invalid question set");
    }
    questions = generatedQuestions;
  } catch (error) {
    if (generation !== quizBuildGeneration) return false;
    console.error("AI quiz generation failed; using local questions", error);
    try {
      questions = buildLocalQuizQuestions(target);
      showToast("สร้างข้อสอบ AI ไม่สำเร็จ ใช้คลังข้อสอบสำรองแทน");
    } catch (fallbackError) {
      console.error("Local quiz fallback failed", fallbackError);
      const quizArea = document.getElementById("quizArea");
      if (quizArea) {
        quizArea.innerHTML = `
          <div class="quiz-card quiz-build-error" role="alert">
            สร้างชุดข้อสอบไม่สำเร็จ กรุณากดสุ่มสร้างชุดใหม่อีกครั้ง
          </div>
        `;
      }
      showToast("สร้างชุดข้อสอบไม่สำเร็จ");
      return false;
    }
  } finally {
    clearTimeout(timeoutId);
    if (generation === quizBuildGeneration) {
      setQuizControlsDisabled(false);
      quizBuildController = null;
    }
  }

  if (generation !== quizBuildGeneration) return false;
  quizQuestions = questions.map((question) => ({ ...question }));
  quizTotalQuestions += quizQuestions.length;
  return true;
}

function subscribeLeaderboard() {
  const leaderboard = document.getElementById("leaderboard");
  leaderboardUnsubscribe = onSnapshot(
    query(collection(db, "leaderboard"), orderBy("totalScore", "desc"), limit(10)),
    (snapshot) => {
      leaderboard.innerHTML = `
        <h2>🏆 แดชบอร์ดจัดอันดับ (Top 10)</h2>
        ${snapshot.empty ? `<p class="leaderboard-empty">ยังไม่มีผู้เล่นบนกระดาน มาเริ่มเล่นกันเลย! ✨</p>` : `
          <ol class="leaderboard-list">
            ${snapshot.docs.map((entry, index) => {
              const player = entry.data();
              const medal = ["🥇", "🥈", "🥉"][index] || `${index + 1}.`;
              return `
                <li>
                  <span class="leaderboard-rank">${medal}</span>
                  <span class="leaderboard-name">${escapeHtml(player.displayName || "ผู้เล่น")}</span>
                  <span class="leaderboard-rounds">${Number(player.quizzesPlayed) || 0} รอบ</span>
                  <strong class="leaderboard-score">${Number(player.totalScore) || 0} คะแนน</strong>
                </li>
              `;
            }).join("")}
          </ol>
        `}
      `;
    },
    (error) => {
      console.error(error);
      leaderboard.textContent = "โหลดอันดับไม่สำเร็จ";
    }
  );
}

function renderQuizQuestion() {
  const quizArea = document.getElementById("quizArea");
  if (!quizArea) return;

  if (quizFinished) {
    const reviewMode = isMistakeReviewMode;
    quizArea.innerHTML = `
      <div class="quiz-card result-card">
        <div class="score-cloud">☁️<span>${quizScore}/${quizTotalQuestions}</span><small>${reviewMode ? "คะแนนทบทวน" : "คะแนนสะสม"}</small></div>
        <h2>${reviewMode ? "ทบทวนข้อที่เคยตอบผิดครบแล้ว 🌸" : "ชุดควิซจบแล้วน้า 🌸"}</h2>
        <p>${reviewMode
          ? `ทบทวนถูก ${quizSetScore} จาก ${quizTotalQuestions} ข้อ`
          : `หมวด ${escapeHtml(activeQuizCategory)} · ชุดนี้ได้ ${quizSetScore} คะแนน · สะสม ${quizScore} จาก ${quizTotalQuestions} ข้อ`}</p>
        <p class="combo-stat">🔥 คอมโบสูงสุด (Max Combo): ${maxCombo} ครั้ง</p>
        ${reviewMode
          ? ""
          : currentUser
            ? `<p class="score-save-status">กำลังบันทึกคะแนนขึ้นอันดับ...</p>`
            : `<p class="score-save-status">ล็อกอินเพื่อบันทึกคะแนนและเก็บอันดับของคุณ</p>`}
        <div class="result-actions">
          ${reviewMode
            ? `<button id="backToNormalQuiz" class="primary-button" type="button">กลับไปทำควิซปกติ</button>`
            : `${quizCount === "∞" ? `<button id="continueQuiz" class="primary-button" type="button">ลุยต่ออีก 20 ข้อ (สะสมคะแนนต่อ) ∞</button>` : ""}
              <button id="retryQuiz" class="primary-button" type="button">สุ่มชุดใหม่อีกที</button>
              ${currentUser ? "" : `<button id="loginForLeaderboard" class="secondary-button" type="button">ล็อกอินเพื่อเก็บอันดับ</button>`}`}
          <button id="backLibrary" class="secondary-button" type="button">ไปคลังชีท</button>
        </div>
      </div>
    `;
    if (!reviewMode && currentUser) saveQuizResult();
    if (reviewMode) {
      document.getElementById("backToNormalQuiz").addEventListener("click", generateQuizSet);
    } else {
      document.getElementById("continueQuiz")?.addEventListener("click", async () => {
        quizIndex = 0;
        quizSetScore = 0;
        quizAnswered = false;
        quizFinished = false;
        quizResultSaved = false;
        if (await buildQuizQuestions()) renderQuizQuestion();
      });
      document.getElementById("retryQuiz").addEventListener("click", generateQuizSet);
      document.getElementById("loginForLeaderboard")?.addEventListener("click", handleLogin);
    }
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
        <span class="quiz-score-group">
          <span>คะแนน <strong>${quizScore}</strong></span>
          ${currentCombo >= 2 ? `<span class="combo-badge">🔥 Combo x${currentCombo}</span>` : ""}
        </span>
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
  let mistakeRemoved = false;
  const answerButtons = [...document.querySelectorAll(".answer-button")];
  const selectedButton = answerButtons[selectedIndex];
  answerButtons.forEach((button, index) => {
    button.disabled = true;
    if (index === question.answer) button.classList.add("correct");
    if (index === selectedIndex && !correct) button.classList.add("wrong");
  });
  if (correct) {
    quizScore += 1;
    quizSetScore += 1;
    currentCombo += 1;
    maxCombo = Math.max(maxCombo, currentCombo);
    if (currentCombo >= 3) launchComboBurst(selectedButton);
    if (isMistakeReviewMode) {
      mistakeRemoved = removeFromMistakeNotebook(question.question);
      updateReviewMistakesButton();
    }
  } else {
    currentCombo = 0;
    saveToMistakeNotebook(question);
    updateReviewMistakesButton();
  }
  document.body.classList.add(correct ? "answer-success" : "answer-error");
  setTimeout(() => document.body.classList.remove("answer-success", "answer-error"), 520);
  const parts = explanationParts(question);
  document.getElementById("explanationArea").innerHTML = `
    <div class="explanation ${correct ? "correct" : "wrong"}">
      <strong>${correct ? "ถูกต้องจ้า! 🌟" : "ลองใหม่อีกนิดนะ 💗"}</strong>
      ${correct && isMistakeReviewMode
        ? `<span class="mistake-removed-message">${mistakeRemoved ? "จำได้แล้ว! ลบออกจากสมุดข้อผิดเรียบร้อย ✨" : "ลบข้อสอบออกจากสมุดข้อผิดไม่สำเร็จ กรุณาลองอีกครั้ง"}</span>`
        : ""}
      <span class="explanation-body">${escapeHtml(parts.body)}</span>
      <div class="key-terms"><strong>ศัพท์สำคัญ</strong><span>${escapeHtml(parts.terms)}</span></div>
    </div>
  `;
  const progressScore = document.querySelector(".quiz-score-group strong");
  if (progressScore) progressScore.textContent = quizScore;
  const comboBadge = document.querySelector(".quiz-score-group .combo-badge");
  const scoreGroup = document.querySelector(".quiz-score-group");
  if (currentCombo >= 2) {
    const badge = comboBadge || document.createElement("span");
    badge.className = "combo-badge";
    badge.textContent = `🔥 Combo x${currentCombo}`;
    if (!comboBadge) scoreGroup.appendChild(badge);
  } else {
    comboBadge?.remove();
  }
  document.getElementById("nextQuestion").disabled = false;
}

function launchComboBurst(target) {
  if (!target) return;
  const bounds = target.getBoundingClientRect();
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8;
    const particle = document.createElement("span");
    particle.className = "combo-spark";
    particle.textContent = "✦";
    particle.style.left = `${bounds.left + bounds.width / 2}px`;
    particle.style.top = `${bounds.top + bounds.height / 2}px`;
    particle.style.setProperty("--combo-x", `${Math.cos(angle) * 38}px`);
    particle.style.setProperty("--combo-y", `${Math.sin(angle) * 38}px`);
    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 700);
  }
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

async function saveQuizResult() {
  if (!currentUser || quizResultSaved) return;
  quizResultSaved = true;
  const resultBatch = quizTotalQuestions;
  const status = document.querySelector(".score-save-status");
  try {
    await setDoc(doc(db, "leaderboard", currentUser.uid), {
      email: currentUser.email || "",
      displayName: playerDisplayName || currentUser.displayName || currentUser.email || "ผู้เล่น",
      totalScore: increment(quizSetScore),
      quizzesPlayed: increment(1),
      updatedAt: serverTimestamp()
    }, { merge: true });
    if (status) status.textContent = "บันทึกคะแนนขึ้นอันดับแล้ว! 🎉";
    showToast("บันทึกคะแนนขึ้นอันดับแล้ว!");
  } catch (error) {
    console.error(error);
    if (quizTotalQuestions === resultBatch) quizResultSaved = false;
    if (status) status.textContent = "บันทึกคะแนนไม่สำเร็จ กรุณาลองใหม่";
    showToast("บันทึกคะแนนไม่สำเร็จ");
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
  const cometColors = ["251,207,232", "186,230,253", "233,213,255"];
  let stars = [];
  let bubbles = [];
  let sparkles = [];
  let ambientSparkles = [];
  let shootingStars = [];
  let frameCount = 0;
  let nextShootingStarFrame = 200 + Math.random() * 200;
  let pointer = { x: innerWidth / 2, y: innerHeight / 2 };

  function createBubble(atBottom = false) {
    const radius = Math.random() * 16 + 8;
    return {
      x: Math.random() * canvas.width,
      y: atBottom ? canvas.height + radius : Math.random() * canvas.height,
      radius,
      speed: Math.random() * .18 + .08,
      tint: Math.random() < .5 ? "rgba(251,207,232,.24)" : "rgba(186,230,253,.24)",
      vx: 0,
      vy: 0,
      interactionCooldown: 0,
      popped: false
    };
  }

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
      speed: Math.random() * .18 + .08,
      tint: Math.random() < .5 ? "rgba(251,207,232,.24)" : "rgba(186,230,253,.24)",
      vx: 0,
      vy: 0,
      interactionCooldown: 0,
      popped: false
    }));
    ambientSparkles = Array.from({
      length: Math.min(48, Math.max(24, Math.floor(canvas.width * canvas.height / 22000)))
    }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 1.2 + .35,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * .0008 + .00025
    }));
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (sparkles.length < 24) {
      sparkles.push({
        x: event.clientX,
        y: event.clientY,
        life: 1,
        radius: Math.random() * 2 + 1,
        vx: (Math.random() - .5) * .5,
        vy: (Math.random() - .5) * .5
      });
    }
    bubbles.forEach((bubble) => {
      if (bubble.popped || bubble.interactionCooldown > 0) return;
      const dx = bubble.x - pointer.x;
      const dy = bubble.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance > bubble.radius + 18) return;
      if (Math.random() < .22) {
        bubble.popped = true;
        for (let index = 0; index < 6 && sparkles.length < 24; index += 1) {
          const angle = (Math.PI * 2 * index) / 6;
          sparkles.push({
            x: bubble.x,
            y: bubble.y,
            life: .9,
            radius: Math.random() * 2 + 1,
            vx: Math.cos(angle) * (Math.random() * 1.4 + .7),
            vy: Math.sin(angle) * (Math.random() * 1.4 + .7)
          });
        }
      } else {
        const force = (bubble.radius + 18 - distance) * .12 + .8;
        bubble.vx += (dx / (distance || 1)) * force;
        bubble.vy += (dy / (distance || 1)) * force;
        bubble.interactionCooldown = 8;
      }
    });
  });

  function draw(time) {
    frameCount += 1;
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (frameCount >= nextShootingStarFrame) {
      shootingStars.push({
        x: Math.random() * canvas.width * .4,
        y: Math.random() * canvas.height * .35,
        vx: 10 + Math.random() * 4,
        vy: 4 + Math.random() * 3,
        life: 1,
        color: cometColors[Math.floor(Math.random() * cometColors.length)]
      });
      nextShootingStarFrame = frameCount + 200 + Math.random() * 200;
    }

    bubbles = bubbles.filter((bubble) => !bubble.popped);
    while (bubbles.length < 12) bubbles.push(createBubble(true));
    context.save();
    bubbles.forEach((bubble) => {
      if (bubble.interactionCooldown > 0) bubble.interactionCooldown -= 1;
      bubble.vx *= .96;
      bubble.vy *= .96;
      bubble.x += bubble.vx;
      bubble.y += bubble.vy - bubble.speed;
      if (bubble.y + bubble.radius < 0 || bubble.x < -bubble.radius || bubble.x > canvas.width + bubble.radius) {
        bubble.x = Math.random() * canvas.width;
        bubble.y = canvas.height + bubble.radius;
        bubble.vx = 0;
        bubble.vy = 0;
      }
      context.beginPath();
      context.globalAlpha = .8;
      context.fillStyle = "rgba(255,255,255,.15)";
      context.strokeStyle = bubble.tint;
      context.lineWidth = 1;
      context.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.beginPath();
      context.globalAlpha = .58;
      context.strokeStyle = "rgba(255,255,255,.62)";
      context.ellipse(
        bubble.x - bubble.radius * .12,
        bubble.y - bubble.radius * .12,
        bubble.radius * .68,
        bubble.radius * .42,
        -.55,
        Math.PI * 1.05,
        Math.PI * 1.8
      );
      context.stroke();
    });
    context.restore();

    context.save();
    ambientSparkles.forEach((sparkle, index) => {
      const drift = time * sparkle.speed + sparkle.phase;
      sparkle.x += Math.cos(drift) * .08;
      sparkle.y += Math.sin(drift) * .08;
      if (sparkle.x < 0) sparkle.x += canvas.width;
      if (sparkle.x > canvas.width) sparkle.x -= canvas.width;
      if (sparkle.y < 0) sparkle.y += canvas.height;
      if (sparkle.y > canvas.height) sparkle.y -= canvas.height;
      context.globalAlpha = .14 + (Math.sin(drift * 2) + 1) * .12;
      context.fillStyle = index % 3 === 0 ? "#c084fc" : index % 3 === 1 ? "#7dd3fc" : "#f9a8d4";
      context.beginPath();
      context.arc(sparkle.x, sparkle.y, sparkle.radius, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();

    context.save();
    stars.forEach((star) => {
      const pulse = .35 + Math.abs(Math.sin(time * star.speed + star.phase)) * .65;
      context.globalAlpha = pulse;
      context.beginPath();
      context.fillStyle = star.radius > 1.7 ? "rgba(168,85,247,.25)" : "rgba(56,189,248,.25)";
      context.shadowBlur = 5;
      context.shadowColor = "rgba(168,85,247,.18)";
      context.arc(star.x + (pointer.x - canvas.width / 2) * .006, star.y, star.radius, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();

    context.save();
    context.beginPath();
    context.lineWidth = .8;
    context.strokeStyle = "rgba(168, 85, 247, 0.08)";
    for (let first = 0; first < stars.length; first += 1) {
      for (let second = first + 1; second < stars.length; second += 1) {
        const distance = Math.hypot(stars[first].x - stars[second].x, stars[first].y - stars[second].y);
        if (distance < 105 && (first + second) % 4 === 0) {
          context.moveTo(stars[first].x, stars[first].y);
          context.lineTo(stars[second].x, stars[second].y);
        }
      }
    }
    context.stroke();
    context.strokeStyle = "rgba(56,189,248,.12)";
    stars.forEach((star) => {
      const distance = Math.hypot(star.x - pointer.x, star.y - pointer.y);
      if (distance > 170) return;
      context.globalAlpha = 1 - distance / 170;
      context.beginPath();
      context.moveTo(star.x, star.y);
      context.lineTo(pointer.x, pointer.y);
      context.stroke();
    });
    context.restore();

    shootingStars = shootingStars.filter((star) => star.life > 0);
    context.save();
    context.lineWidth = 2;
    context.lineCap = "round";
    context.shadowBlur = 10;
    shootingStars.forEach((star) => {
      star.x += star.vx;
      star.y += star.vy;
      star.life -= .012;
      const tail = context.createLinearGradient(
        star.x - star.vx * 18,
        star.y - star.vy * 18,
        star.x,
        star.y
      );
      tail.addColorStop(0, "rgba(255,255,255,0)");
      tail.addColorStop(1, `rgba(${star.color},${star.life})`);
      context.strokeStyle = tail;
      context.shadowColor = `rgba(${star.color},.42)`;
      context.beginPath();
      context.moveTo(star.x - star.vx * 18, star.y - star.vy * 18);
      context.lineTo(star.x, star.y);
      context.stroke();
    });
    context.restore();

    sparkles = sparkles.filter((sparkle) => sparkle.life > 0);
    sparkles.forEach((sparkle) => {
      sparkle.life -= .035;
      sparkle.x += sparkle.vx || 0;
      sparkle.y += sparkle.vy || 0;
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

async function setPlayerDisplayName(user, name) {
  const displayName = name.trim();
  if (!displayName) {
    showToast("กรุณากรอกชื่อที่ต้องการแสดง");
    return;
  }
  try {
    const playerRef = doc(db, "leaderboard", user.uid);
    const playerSnapshot = await getDoc(playerRef);
    const profile = {
      displayName,
      email: user.email || "",
      updatedAt: serverTimestamp()
    };
    const savedProfile = playerSnapshot.exists() ? playerSnapshot.data() : {};
    if (savedProfile.totalScore == null) profile.totalScore = 0;
    if (savedProfile.quizzesPlayed == null) profile.quizzesPlayed = 0;
    await setDoc(playerRef, profile, { merge: true });
    playerDisplayName = displayName;
    showToast("อัปเดตชื่อบนบอร์ดแล้ว!");
  } catch (error) {
    console.error(error);
    showToast("บันทึกชื่อบนบอร์ดไม่สำเร็จ");
  }
}

async function promptPlayerDisplayName(user, existingName = "") {
  const name = prompt("กรอกชื่อที่ต้องการแสดงบนกระดานจัดอันดับ", existingName);
  if (name === null) return;
  await setPlayerDisplayName(user, name);
}

async function changePlayerDisplayName() {
  if (!currentUser) return;
  await promptPlayerDisplayName(currentUser, playerDisplayName || currentUser.displayName || "");
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
      showToast("ล็อกอินด้วย Google สำเร็จ!");
    }
  })
  .catch((error) => {
    console.error(error);
    showToast(error.code === "auth/popup-blocked"
      ? "เบราว์เซอร์ปิดหน้าล็อกอิน กรุณาลองอีกครั้ง"
      : "ล็อกอินด้วย Google ไม่สำเร็จ");
  });

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  isAdmin = Boolean(user && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  recordPageView(user);
  document.getElementById("adminBadge").hidden = !isAdmin;
  document.getElementById("adminActions").hidden = !isAdmin;
  document.getElementById("announcementAdminActions").hidden = !isAdmin;
  document.getElementById("loginButton").hidden = Boolean(user);
  document.getElementById("logoutButton").hidden = !user;
  document.getElementById("changeDisplayNameButton").hidden = !user;
  if (!user) {
    playerDisplayName = "";
  } else {
    try {
      const playerSnapshot = await getDoc(doc(db, "leaderboard", user.uid));
      const savedName = playerSnapshot.exists() ? playerSnapshot.data().displayName : "";
      if (savedName) {
        playerDisplayName = String(savedName);
      } else {
        await promptPlayerDisplayName(user, user.displayName || "");
      }
      if (quizFinished && !isMistakeReviewMode && !quizResultSaved) saveQuizResult();
    } catch (error) {
      console.error(error);
      showToast("โหลดข้อมูลผู้เล่นไม่สำเร็จ");
    }
  }
  if (document.querySelector(".nav-tab.active")?.dataset.view === "library") renderLibrary();
});

document.getElementById("homeBrand").addEventListener("click", () => setView("library"));
document.getElementById("libraryNav").addEventListener("click", () => setView("library"));
document.getElementById("quizNav").addEventListener("click", () => setView("quiz"));
document.getElementById("loginButton").addEventListener("click", handleLogin);
document.getElementById("logoutButton").addEventListener("click", handleLogout);
document.getElementById("changeDisplayNameButton").addEventListener("click", changePlayerDisplayName);
document.getElementById("addContentButton").addEventListener("click", openAddContentModal);
document.getElementById("addQuizButton").addEventListener("click", openAddQuizModal);
document.getElementById("addAnnouncementButton").addEventListener("click", saveAnnouncement);
document.getElementById("editAnnouncementButton").addEventListener("click", saveAnnouncement);
document.getElementById("deleteAnnouncementButton").addEventListener("click", deleteAnnouncement);
document.querySelector("[data-close-modal]").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) closeModal();
});

subscribeFirestore();
startAuroraCanvas();
renderLibrary();
