import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ---- Инициализация Firebase ----
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ---- DOM-элементы ----
const authScreen   = document.getElementById("auth-screen");
const chatScreen   = document.getElementById("chat-screen");
const authForm     = document.getElementById("auth-form");
const emailInput   = document.getElementById("email");
const passwordInput= document.getElementById("password");
const loginBtn     = document.getElementById("login-btn");
const registerBtn  = document.getElementById("register-btn");
const authError    = document.getElementById("auth-error");
const userEmailEl  = document.getElementById("user-email");
const logoutBtn    = document.getElementById("logout-btn");
const messagesEl   = document.getElementById("messages");
const messageForm  = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendBtn      = document.getElementById("send-btn");
const chatError    = document.getElementById("chat-error");

let unsubscribe = null; // отписка от прослушивания сообщений
let isRegisterIntent = false; // какая кнопка нажата в форме авторизации

// ---- Утилиты ----
function showAuthError(msg) { authError.textContent = msg; }
function showChatError(msg) { chatError.textContent = msg; setTimeout(() => chatError.textContent = "", 4000); }

function formatTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function renderMessage(data) {
  const div = document.createElement("div");
  div.className = "msg " + (data.role === "user" ? "user" : "bot");
  div.textContent = data.text;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = formatTime(data.timestamp) + (data.role === "bot" ? " · бот" : " · вы");
  div.appendChild(meta);

  // Бейдж статуса для сообщений пользователя (пока не отвечено)
  if (data.role === "user" && data.status && data.status !== "answered") {
    const badge = document.createElement("span");
    badge.className = "status-badge status-" + data.status;
    if (data.status === "queued") {
      badge.textContent = "⏳ в очереди";
    } else if (data.status === "typing") {
      badge.textContent = "✍️ бот печатает…";
    }
    div.appendChild(badge);
  }

  return div;
}

// ---- Авторизация ----
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showAuthError("");
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const register = isRegisterIntent;
  isRegisterIntent = false;
  try {
    if (register) {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    showAuthError(translateError(err));
  }
});

registerBtn.addEventListener("click", () => {
  isRegisterIntent = true;
});

logoutBtn.addEventListener("click", () => signOut(auth));

// ---- Смена экрана при изменении состояния авторизации ----
onAuthStateChanged(auth, (user) => {
  if (user) {
    authScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    userEmailEl.textContent = user.email;
    listenMessages(user.uid);
  } else {
    authScreen.classList.remove("hidden");
    chatScreen.classList.add("hidden");
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    messagesEl.innerHTML = "";
  }
});

// ---- Чтение сообщений из Firestore ----
function listenMessages(uid) {
  // Запрос только по userId (без orderBy по timestamp — иначе нужен составной индекс).
  // Сортируем на клиенте по timestamp.
  const q = query(
    collection(db, "messages"),
    where("userId", "==", uid)
  );
  unsubscribe = onSnapshot(q, (snap) => {
    const docs = [];
    snap.forEach((doc) => docs.push(doc.data()));
    // Сообщения без timestamp (только что отправленные) кладём в конец
    docs.sort((a, b) => {
      const ta = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : 0) : 0;
      const tb = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : 0) : 0;
      return ta - tb;
    });
    messagesEl.innerHTML = "";
    docs.forEach((d) => messagesEl.appendChild(renderMessage(d)));
    // прокрутка вниз
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }, (err) => {
    showChatError("Ошибка загрузки сообщений: " + err.message);
  });
}

// ---- Отправка сообщения ----
messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  const user = auth.currentUser;
  if (!user) return;

  sendBtn.disabled = true;
  try {
    await addDoc(collection(db, "messages"), {
      userId:    user.uid,
      userEmail: user.email,
      text:      text,
      role:      "user",
      status:    "queued",
      timestamp: serverTimestamp()
    });
    messageInput.value = "";
  } catch (err) {
    showChatError("Не удалось отправить: " + err.message);
  } finally {
    sendBtn.disabled = false;
  }
});

// ---- Перевод ошибок Firebase ----
function translateError(err) {
  switch (err.code) {
    case "auth/invalid-email":        return "Неверный формат email.";
    case "auth/user-not-found":       return "Пользователь не найден.";
    case "auth/wrong-password":       return "Неверный пароль.";
    case "auth/invalid-credential":   return "Неверный email или пароль.";
    case "auth/email-already-in-use": return "Этот email уже зарегистрирован.";
    case "auth/weak-password":        return "Пароль слишком слабый (минимум 6 символов).";
    case "auth/too-many-requests":    return "Слишком много попыток. Попробуйте позже.";
    default: return err.message;
  }
}
