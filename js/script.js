const firebaseConfig = {
  apiKey: "AIzaSyDK0rK42F-VLi5J3DH0KmzT5pGnt_3HbUg",
  authDomain: "spottheradios.firebaseapp.com",
  projectId: "spottheradios",
  storageBucket: "spottheradios.firebasestorage.app",
  messagingSenderId: "749170419874",
  appId: "1:749170419874:web:61028b2a80b4c1581b0ffb",
  databaseURL: "https://spottheradios-default-rtdb.europe-west1.firebasedatabase.app"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const quizzesRef = db.ref('quizzes');
const allScoresRef = db.ref('quiz_scores');

const modeIcons = { mcq:'📝', binary:'⚡', sequence:'🔢', triage:'🗂️', acronym:'🔤', spot:'🎯', pin:'📌', catchphrase:'🟩' };

let availableQuizzes = {};
let activeQuiz = null, activeScoreListener = null;
let playerName = "", timeLeft = 60, timerInterval = null, cpTileInterval = null;
let scoreCount = 0, misses = 0, totalPossible = 10, sessionDetails = [];
let currentSessionId = Date.now() + "_" + Math.random().toString(36).substring(2, 7);

let activeItems = [], currentIndex = 0, seqProgress = 0;
let parsedDocItems = [], builderTargets = [], uploadedBase64Image = "";
let currentStudioStepNum = 1;

quizzesRef.on('value', (snap) => {
  availableQuizzes = {};
  const data = snap.val();
  if (data) Object.keys(data).forEach(k => availableQuizzes[k] = { ...data[k], id: k });
  populateQuizDropdown();
  if (document.getElementById("delete-manager-modal").style.display === "flex") {
    renderDeleteQuizList();
  }
});

function populateQuizDropdown() {
  const sel = document.getElementById("quiz-selector");
  const prev = sel.value;
  sel.innerHTML = `<option value="" disabled ${!prev ? 'selected' : ''}>-- Select a Quiz --</option>`;
  const quizKeys = Object.keys(availableQuizzes);
  
  if (quizKeys.length === 0) {
    sel.innerHTML = `<option value="" disabled selected>-- No Quizzes in Database (Create one in Studio) --</option>`;
  } else {
    Object.values(availableQuizzes).forEach(q => {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.textContent = `${modeIcons[q.type] || '🎯'} ${q.title}`;
      sel.appendChild(opt);
    });
    if (prev && availableQuizzes[prev]) {
      sel.value = prev;
    } else {
      sel.value = "";
    }
  }
  onQuizSelectChange();
}

function onQuizSelectChange() {
  const selId = document.getElementById("quiz-selector").value;
  const previewCard = document.getElementById("quiz-preview-card");
  
  if (!selId || !availableQuizzes[selId]) {
    activeQuiz = null;
    previewCard.style.display = "none";
    document.getElementById("sidebar-lb-list").innerHTML = `<div class="lb-item" style="justify-content: center; color: var(--text-muted); border:none;">Select a quiz to view scores.</div>`;
    return;
  }

  activeQuiz = availableQuizzes[selId];
  previewCard.style.display = "grid";

  document.getElementById("q-prev-img").src = activeQuiz.image || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  document.getElementById("q-prev-title").textContent = activeQuiz.title;
  document.getElementById("q-prev-desc").textContent = activeQuiz.description || "Classroom training module.";
  document.getElementById("q-prev-qtype").textContent = activeQuiz.qtype || activeQuiz.type.toUpperCase();
  const count = activeQuiz.targets ? activeQuiz.targets.length : (activeQuiz.items ? (activeQuiz.limit > 0 ? Math.min(activeQuiz.limit, activeQuiz.items.length) : activeQuiz.items.length) : 10);
  document.getElementById("q-prev-qcount").textContent = count;
  document.getElementById("q-prev-time").textContent = `${activeQuiz.timeLimit} Seconds`;
  document.getElementById("q-prev-diff").innerHTML = `<span class="tag-diff">${activeQuiz.difficulty || 'Intermediate'}</span>`;
  document.getElementById("q-prev-obj").textContent = activeQuiz.objective || "Test your knowledge and reinforce learning.";

  if (activeScoreListener) activeScoreListener.off();
  activeScoreListener = allScoresRef.child(activeQuiz.id);
  activeScoreListener.on('value', (snap) => {
    const data = snap.val();
    const lbList = document.getElementById("sidebar-lb-list");
    if (!data) {
      lbList.innerHTML = `<div class="lb-item" style="justify-content: center; color: var(--text-muted); border:none;">No scores yet. Be the first!</div>`;
      return;
    }
    const scores = Object.values(data);
    scores.sort((a, b) => b.found !== a.found ? b.found - a.found : (a.time !== b.time ? a.time - b.time : a.misses - b.misses));
    const top3 = scores.slice(0, 3);
    lbList.innerHTML = top3.map((s, i) => `
      <div class="lb-item">
        <div class="lb-rank lb-rank-${i+1}">${i+1}</div>
        <div class="lb-name">${escapeHtml(s.name)}</div>
        <div class="lb-score">${s.found}/${s.total || count}</div>
        <div class="lb-time">${s.time}s</div>
      </div>
    `).join("");
  });
}

function startGame() {
  if (!activeQuiz) return alert("Please select a quiz from the dropdown menu first!");
  playerName = document.getElementById("player-name").value.trim();
  if (!playerName) return alert("Please enter your name!");

  timeLeft = parseInt(activeQuiz.timeLimit) || 60;
  scoreCount = 0; misses = 0; currentIndex = 0; sessionDetails = [];
  currentSessionId = Date.now() + "_" + Math.random().toString(36).substring(2, 7);

  if (activeQuiz.type === "spot" || activeQuiz.type === "pin") {
    setupVisualMode();
  } else if (activeQuiz.type === "catchphrase") {
    setupCatchphraseMode();
  } else {
    setupCardMode();
  }
}

function setupVisualMode() {
  document.getElementById("visual-stage").style.display = "flex";
  document.getElementById("scene").src = activeQuiz.image || "";
  document.querySelectorAll(".marker, .pin-marker").forEach(m => m.remove());
  
  activeItems = (activeQuiz.targets || []).map((t, i) => ({ ...t, idx: i + 1, found: false }));
  totalPossible = activeItems.length;

  if (activeQuiz.type === "pin") {
    document.getElementById("pin-prompt-bar").style.display = "block";
    const wrap = document.getElementById("img-wrap");
    activeItems.forEach(t => {
      const p = document.createElement("div");
      p.className = "pin-marker"; p.id = "pin_" + t.idx; p.textContent = t.idx;
      p.style.left = t.x + "%"; p.style.top = t.y + "%";
      wrap.appendChild(p);
    });
    renderNextPin();
  } else {
    document.getElementById("pin-prompt-bar").style.display = "none";
  }
}

function renderNextPin() {
  if (currentIndex >= activeItems.length) return endGame(true);
  document.querySelectorAll(".pin-marker").forEach(p => p.classList.remove("active"));
  const cur = activeItems[currentIndex];
  const activePin = document.getElementById("pin_" + cur.idx);
  if (activePin) activePin.classList.add("active");
  document.getElementById("pin-progress").textContent = `Identify Pin #${cur.idx} (${currentIndex + 1} of ${activeItems.length})`;

  const optsDiv = document.getElementById("pin-options");
  optsDiv.innerHTML = "";
  [...activeItems].sort(() => Math.random() - 0.5).forEach(item => {
    const b = document.createElement("button");
    b.className = "btn" + (item.found ? " used" : "");
    b.style.background = "#1e293b"; b.style.color = "#fff"; b.style.border = "1px solid var(--border-color)"; b.textContent = item.name;
    b.onclick = () => {
      if (item.idx === cur.idx) {
        cur.found = true; scoreCount++;
        activePin.classList.remove("active"); activePin.classList.add("done");
        sessionDetails.push({ label: `Pin ${cur.idx}: ${cur.name}`, ok: true });
        currentIndex++; renderNextPin();
      } else { misses++; }
    };
    optsDiv.appendChild(b);
  });
}

document.getElementById("scene").addEventListener("click", function(e) {
  if (!activeQuiz || activeQuiz.type !== "spot") return;
  const rect = this.getBoundingClientRect();
  const clickX = ((e.clientX - rect.left) / rect.width) * 100;
  const clickY = ((e.clientY - rect.top) / rect.height) * 100;
  
  const hit = activeItems.find(item => !item.found && Math.hypot(clickX - item.x, clickY - item.y) <= (item.r || 6));
  if (hit) {
    hit.found = true; scoreCount++;
    const m = document.createElement("div");
    m.style.position = "absolute"; 
    m.style.border = "3px solid #22c55e"; 
    m.style.background = "rgba(34, 197, 94, 0.3)";
    m.style.borderRadius = "50%"; 
    m.style.transform = "translate(-50%, -50%)";
    m.style.left = hit.x + "%"; 
    m.style.top = hit.y + "%"; 
    m.style.width = ((hit.r || 6) * 2) + "%"; 
    m.style.aspectRatio = "1/1";
    document.getElementById("img-wrap").appendChild(m);
    
    sessionDetails.push({ label: `Found ${hit.name || 'Target'}`, ok: true });
    if (scoreCount === activeItems.length) {
      setTimeout(() => endGame(true), 600);
    }
  } else { 
    misses++; 
  }
});

function setupCardMode() {
  document.getElementById("card-stage").style.display = "flex";
  let pool = JSON.parse(JSON.stringify(activeQuiz.items || []));
  if (activeQuiz.randomize) pool.sort(() => Math.random() - 0.5);
  if (activeQuiz.limit > 0 && activeQuiz.limit < pool.length) pool = pool.slice(0, activeQuiz.limit);
  activeItems = pool;
  totalPossible = pool.length;
  renderCardItem();
}

function renderCardItem() {
  if (currentIndex >= activeItems.length) return endGame(true);
  const item = activeItems[currentIndex];
  document.getElementById("card-progress").textContent = `Item ${currentIndex + 1} of ${activeItems.length}`;
  document.getElementById("card-prompt").textContent = item.q;
  const inter = document.getElementById("card-interactive");
  inter.innerHTML = "";

  const rightText = item.options[item.correct];
  const opts = activeQuiz.randomize ? [...item.options].sort(() => Math.random() - 0.5) : [...item.options];
  opts.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "btn"; b.style.background = "#1e293b"; b.style.color = "#fff"; b.style.border = "1px solid var(--border-color)"; b.style.textAlign = "left";
    b.textContent = `${["A","B","C","D","E"][i]}. ${opt}`;
    b.onclick = () => recordCardStep(opt === rightText, `Q${currentIndex+1}: ${item.q.substring(0,25)}...`);
    inter.appendChild(b);
  });
}

function recordCardStep(isRight, labelText) {
  if (isRight) scoreCount++; else misses++;
  sessionDetails.push({ label: labelText, ok: isRight });
  currentIndex++;
  renderCardItem();
}

function setupCatchphraseMode() {
  document.getElementById("catchphrase-stage").style.display = "flex";
  totalPossible = 16;
  document.getElementById("cp-clue-display").textContent = activeQuiz.clue || "Identify the hidden image!";
  document.getElementById("cp-game-img").src = activeQuiz.image;
  const grid = document.getElementById("cp-grid");
  grid.innerHTML = "";
  let indices = [];
  for (let i = 0; i < 16; i++) {
    indices.push(i);
    const t = document.createElement("div");
    t.id = "cpt_" + i; t.textContent = i + 1;
    t.style.background = "#1e293b"; t.style.border = "1px solid var(--border-color)"; t.style.display = "flex"; t.style.alignItems = "center"; t.style.justifyContent = "center"; t.style.fontWeight = "800"; t.style.color = "#475569";
    grid.appendChild(t);
  }
  indices.sort(() => Math.random() - 0.5);
  const stepMs = Math.max(1200, Math.floor(((activeQuiz.timeLimit || 60) * 1000) / 16));
  cpTileInterval = setInterval(() => {
    if (indices.length === 0) return clearInterval(cpTileInterval);
    const nextIdx = indices.pop();
    const tile = document.getElementById("cpt_" + nextIdx);
    if (tile) { tile.style.opacity = "0"; tile.style.pointerEvents = "none"; }
  }, stepMs);
}

function submitCatchphraseGuess() {
  const guess = document.getElementById("cp-guess-input").value.trim().toLowerCase();
  if (!guess) return;
  const accepted = (activeQuiz.answers || []).map(a => a.toLowerCase());
  if (accepted.some(a => guess === a || guess.includes(a))) {
    clearInterval(cpTileInterval);
    scoreCount = 16;
    sessionDetails = [{ label: `Solved (${guess})`, ok: true }];
    endGame(true);
  } else {
    misses++; document.getElementById("cp-guess-input").value = "";
  }
}

function endGame(completedAll) {
  clearInterval(timerInterval); clearInterval(cpTileInterval);
  document.querySelectorAll(".overlay").forEach(o => o.style.display = "none");
  document.getElementById("end-screen").style.display = "flex";
  document.getElementById("end-title").textContent = completedAll ? "🎉 Challenge Complete!" : "⏱️ Assessment Finished!";
  document.getElementById("end-summary").textContent = `${playerName}: Score ${scoreCount}/${totalPossible}`;

  allScoresRef.child(activeQuiz.id).push({
    id: currentSessionId, name: playerName, found: scoreCount, total: totalPossible,
    time: 45, misses: misses, details: sessionDetails, timestamp: Date.now()
  });
}

function openLeaderboardOnly() {
  if (!activeQuiz) return alert("Please select a quiz from the dropdown menu first!");
  document.getElementById("end-screen").style.display = "flex";
  document.getElementById("end-title").textContent = `🏆 ${activeQuiz.title}`;
  document.getElementById("end-summary").textContent = "Live Classroom Leaderboard";
}

// Studio & Wizard Step Management Logic
function openStudio() {
  document.getElementById("student-view").style.display = "none";
  document.getElementById("studio-view").style.display = "flex";
  switchStudioStep(1);
}
function closeStudio() {
  document.getElementById("studio-view").style.display = "none";
  document.getElementById("student-view").style.display = "block";
}

function switchStudioStep(stepNum) {
  currentStudioStepNum = stepNum;
  for (let i = 1; i <= 5; i++) {
    const pane = document.getElementById(`studio-pane-${i}`);
    const stepIndicator = document.getElementById(`wiz-step-${i}`);
    if (pane) pane.style.display = (i === stepNum) ? "block" : "none";
    if (stepIndicator) {
      stepIndicator.className = "wiz-step";
      if (i < stepNum) stepIndicator.classList.add("completed");
      else if (i === stepNum) stepIndicator.classList.add("active");
    }
  }

  const titles = {
    1: ["Create New Quiz", "Follow the steps below to create a training quiz for your students."],
    2: ["Add Content", "Upload source questions or map interactive target zones on your challenge media."],
    3: ["Game Settings", "Configure timing, scoring penalties, and randomization rules."],
    4: ["Review & Test", "Check your quiz details and preview functionality."],
    5: ["Publish Live", "Make this assessment instantly available to the classroom."]
  };
  document.getElementById("studio-main-heading").textContent = titles[stepNum][0];
  document.getElementById("studio-main-sub").textContent = titles[stepNum][1];

  const nextBtn = document.getElementById("studio-next-btn");
  if (stepNum === 5) {
    nextBtn.innerHTML = `Publish Live <i class="fas fa-rocket"></i>`;
    nextBtn.onclick = publishQuiz;
  } else {
    const nextLabels = { 1: "Next: Add Content", 2: "Next: Game Settings", 3: "Next: Review", 4: "Next: Publish" };
    nextBtn.innerHTML = `${nextLabels[stepNum]} <i class="fas fa-arrow-right"></i>`;
    nextBtn.onclick = nextStudioStep;
  }

  if (stepNum === 2) {
    const type = document.getElementById("build-type").value;
    const isImg = ["spot", "pin", "catchphrase"].includes(type);
    document.getElementById("step2-doc-box").style.display = isImg ? "none" : "block";
    document.getElementById("step2-img-box").style.display = isImg ? "block" : "none";
    if (isImg) {
      const mapImgEl = document.getElementById("step2-map-img");
      if (uploadedBase64Image) {
        mapImgEl.src = uploadedBase64Image;
      } else {
        mapImgEl.src = "radios.jpg";
      }
      renderStep2Markers();
    }
  } else if (stepNum === 4) {
    document.getElementById("rev-title").textContent = document.getElementById("build-title").value || "Untitled Quiz";
    document.getElementById("rev-desc").textContent = document.getElementById("build-desc").value || "";
    document.getElementById("rev-stats").textContent = `Type: ${document.getElementById("build-type").value.toUpperCase()} • Time: ${document.getElementById("build-time").value}s • Difficulty: ${document.getElementById("build-diff").value}`;
  }
}

function nextStudioStep() {
  if (currentStudioStepNum < 5) {
    switchStudioStep(currentStudioStepNum + 1);
  } else {
    publishQuiz();
  }
}

function setDifficulty(level, el) {
  document.querySelectorAll(".diff-card").forEach(c => c.classList.remove("selected"));
  el.classList.add("selected");
  document.getElementById("build-diff").value = level;
  updateLivePreview();
}

function updateLivePreview() {
  const title = document.getElementById("build-title").value || "Custom Quiz";
  const desc = document.getElementById("build-desc").value || "Enter a short overview of your quiz module.";
  const qcount = document.getElementById("build-qcount").value || "10";
  const time = document.getElementById("build-time").value || "60";
  const diff = document.getElementById("build-diff").value || "Intermediate";
  const obj = document.getElementById("build-obj").value || "By completing this quiz, students will master the core learning outcomes.";

  document.getElementById("prev-card-title").textContent = title;
  document.getElementById("prev-card-desc").textContent = desc;
  document.getElementById("prev-card-diff").textContent = diff.toUpperCase();
  document.getElementById("prev-card-qcount").textContent = qcount;
  document.getElementById("prev-card-time").textContent = time;
  document.getElementById("prev-card-diff-lbl").textContent = diff;
  document.getElementById("prev-card-obj").textContent = obj;
}

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = img.width > 900 ? 900 / img.width : 1;
      canvas.width = img.width * scale; canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      uploadedBase64Image = canvas.toDataURL("image/jpeg", 0.78);
      document.getElementById("builder-img").src = uploadedBase64Image;
      document.getElementById("builder-canvas-wrap").style.display = "inline-block";
      document.getElementById("prev-card-img").src = uploadedBase64Image;
      document.getElementById("step2-map-img").src = uploadedBase64Image;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function handleDocxUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.name.endsWith(".txt")) {
    const r = new FileReader();
    r.onload = (ev) => { document.getElementById("raw-text-input").value = ev.target.result; parseCurrentDocText(); };
    r.readAsText(file);
  } else {
    const r = new FileReader();
    r.onload = (ev) => {
      mammoth.extractRawText({ arrayBuffer: ev.target.result }).then(res => {
        document.getElementById("raw-text-input").value = res.value;
        parseCurrentDocText();
      });
    };
    r.readAsArrayBuffer(file);
  }
}

function parseCurrentDocText() {
  const raw = document.getElementById("raw-text-input").value.trim();
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  parsedDocItems = [];
  let cur = null;
  lines.forEach(line => {
    const optMatch = line.match(/^(\*)?([A-E])[\)\.\:]\s*(.+)/i);
    if (optMatch && cur) {
      if (optMatch[1]) cur.correct = cur.options.length;
      cur.options.push(optMatch[3].trim());
      return;
    }
    if (cur && cur.options.length >= 2) parsedDocItems.push(cur);
    cur = { q: line.replace(/^(?:Q\d*|Question\s*\d*|\d+)[\:\.\)]\s*/i, ""), options: [], correct: 0 };
  });
  if (cur && cur.options.length >= 2) parsedDocItems.push(cur);
  document.getElementById("doc-count").textContent = parsedDocItems.length;
  document.getElementById("doc-preview-list").innerHTML = parsedDocItems.map((it, i) => `<div>${i+1}. ${escapeHtml(it.q)}</div>`).join("") || "No valid questions parsed.";
}

function onStep2MapClick(e) {
  const rect = e.target.getBoundingClientRect();
  const x = parseFloat((((e.clientX - rect.left) / rect.width) * 100).toFixed(1));
  const y = parseFloat((((e.clientY - rect.top) / rect.height) * 100).toFixed(1));
  
  const newId = builderTargets.length + 1;
  const default