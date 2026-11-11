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

const modeIcons = { mcq:'📝', spot:'🎯' };

let availableQuizzes = {};
let activeQuiz = null, activeScoreListener = null;
let playerName = "", timeRemaining = 60, timerInterval = null;
let scoreCount = 0, misses = 0, totalPossible = 0, sessionDetails = [];
let currentSessionId = Date.now() + "_" + Math.random().toString(36).substring(2, 7);

let activeItems = [], currentIndex = 0;
let parsedDocItems = [], builderTargets = [], uploadedBase64Image = "";
let currentStudioStepNum = 1;
let repositionTargetId = null;
let editingQuizId = null;
let editingQuestionIndex = null;
let isPreviewMode = false;

// Helper to normalize question text for duplication checks
function normalizeQuestionText(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

// Helper to format seconds into MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Helper to parse YouTube URLs into embed links
function getYouTubeEmbedUrl(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? `https://www.youtube.com/embed/${match[2]}?autoplay=1` : null;
}

quizzesRef.on('value', (snap) => {
  availableQuizzes = {};
  const data = snap.val();
  if (data) {
    Object.keys(data).forEach(k => {
      availableQuizzes[k] = { ...data[k], id: k };
    });
  }
  populateQuizDropdown();
  const deleteModal = document.getElementById("delete-manager-modal");
  if (deleteModal && deleteModal.style.display === "flex") {
    renderDeleteQuizList();
  }
});

function populateQuizDropdown() {
  const sel = document.getElementById("quiz-selector");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="" disabled selected>-- Select a Quiz --</option>`;
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
  const sel = document.getElementById("quiz-selector");
  const previewCard = document.getElementById("quiz-preview-card");
  if (!sel || !previewCard) return;

  const selId = sel.value;
  if (!selId || !availableQuizzes[selId]) {
    activeQuiz = null;
    previewCard.style.display = "none";
    const lbList = document.getElementById("sidebar-lb-list");
    if (lbList) {
      lbList.innerHTML = `<div class="lb-item" style="justify-content: center; color: var(--text-muted); border:none;">Select a quiz to view scores.</div>`;
    }
    return;
  }

  activeQuiz = availableQuizzes[selId];
  previewCard.style.display = "grid";

  const prevImg = document.getElementById("q-prev-img");
  if (prevImg) prevImg.src = activeQuiz.image || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  
  const prevTitle = document.getElementById("q-prev-title");
  if (prevTitle) prevTitle.textContent = activeQuiz.title;
  
  const prevDesc = document.getElementById("q-prev-desc");
  if (prevDesc) prevDesc.textContent = activeQuiz.description || "Classroom training module.";
  
  const prevQtype = document.getElementById("q-prev-qtype");
  if (prevQtype) prevQtype.textContent = activeQuiz.qtype || (activeQuiz.type === 'mcq' ? 'Multiple Choice' : 'Spot the Object');
  
  const rawItems = activeQuiz.items || activeQuiz.questions || [];
  const itemsArray = Array.isArray(rawItems) ? rawItems : Object.values(rawItems);

  let totalCount = 10;
  if (itemsArray.length > 0) {
    totalCount = itemsArray.length;
    if (activeQuiz.limit > 0 && activeQuiz.limit < totalCount) {
      totalCount = activeQuiz.limit;
    }
  } else if (activeQuiz.targets) {
    const targetsArray = Array.isArray(activeQuiz.targets) ? activeQuiz.targets : Object.values(activeQuiz.targets);
    if (targetsArray.length > 0) totalCount = targetsArray.length;
  }
  
  const prevQcount = document.getElementById("q-prev-qcount");
  if (prevQcount) prevQcount.textContent = totalCount;

  const timeLimitMins = activeQuiz.timeLimit ? (activeQuiz.timeLimit / 60) : 1;
  const prevTime = document.getElementById("q-prev-time");
  if (prevTime) prevTime.textContent = `${timeLimitMins} Mins`;
  
  const prevDiff = document.getElementById("q-prev-diff");
  if (prevDiff) prevDiff.innerHTML = `<span class="tag-diff">${activeQuiz.difficulty || 'Intermediate'}</span>`;
  
  const prevObj = document.getElementById("q-prev-obj");
  if (prevObj) prevObj.textContent = activeQuiz.objective || "Test your knowledge and reinforce learning.";

  if (activeScoreListener) activeScoreListener.off();
  activeScoreListener = allScoresRef.child(activeQuiz.id);
  activeScoreListener.on('value', (snap) => {
    const data = snap.val();
    const lbList = document.getElementById("sidebar-lb-list");
    if (!lbList) return;
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
        <div class="lb-score">${s.found}/${s.total || totalCount}</div>
        <div class="lb-time">${formatTime(s.time)}</div>
      </div>
    `).join("");
  });
}

function startGame() {
  if (!activeQuiz) return alert("Please select a quiz from the dropdown menu first!");
  playerName = document.getElementById("player-name").value.trim();
  if (!playerName) return alert("Please enter your name!");

  isPreviewMode = false;
  scoreCount = 0; misses = 0; currentIndex = 0; sessionDetails = [];
  timeRemaining = parseInt(activeQuiz.timeLimit) || 60;
  
  const formattedTime = formatTime(timeRemaining);
  const timerDisplay = document.getElementById("time-remaining");
  const cardTimerDisplay = document.getElementById("card-time-remaining");
  if (timerDisplay) timerDisplay.textContent = formattedTime;
  if (cardTimerDisplay) cardTimerDisplay.textContent = formattedTime;

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeRemaining--;
    const ft = formatTime(Math.max(0, timeRemaining));
    if (timerDisplay) timerDisplay.textContent = ft;
    if (cardTimerDisplay) cardTimerDisplay.textContent = ft;
    if (timeRemaining <= 0) {
      clearInterval(timerInterval);
      triggerTimeUpModal();
    }
  }, 1000);

  currentSessionId = Date.now() + "_" + Math.random().toString(36).substring(2, 7);

  if (activeQuiz.type === "spot") {
    setupVisualMode();
  } else {
    setupCardMode();
  }
}

function startPreviewQuiz() {
  const title = document.getElementById("build-title").value.trim();
  if (!title) return alert("Please enter a Quiz Title first to test the preview!");

  isPreviewMode = true;
  playerName = "Studio Previewer";
  
  const type = document.getElementById("build-type").value;
  const timeInputMins = parseFloat(document.getElementById("set-time") ? document.getElementById("set-time").value : 1) || 1;
  
  activeQuiz = {
    id: "preview_mode",
    title: title,
    type: type,
    timeLimit: Math.round(timeInputMins * 60),
    description: document.getElementById("build-desc").value.trim() || "Preview description",
    image: uploadedBase64Image || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    targets: builderTargets.length > 0 ? builderTargets : [{ id: 1, name: "Target 1", x: 50, y: 50, r: 6 }],
    items: parsedDocItems,
    randomize: document.getElementById("set-random") ? document.getElementById("set-random").checked : true,
    limit: document.getElementById("set-limit") ? parseInt(document.getElementById("set-limit").value) || 0 : 0
  };

  scoreCount = 0; misses = 0; currentIndex = 0; sessionDetails = [];
  timeRemaining = activeQuiz.timeLimit;
  
  const formattedTime = formatTime(timeRemaining);
  const timerDisplay = document.getElementById("time-remaining");
  const cardTimerDisplay = document.getElementById("card-time-remaining");
  if (timerDisplay) timerDisplay.textContent = formattedTime;
  if (cardTimerDisplay) cardTimerDisplay.textContent = formattedTime;

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeRemaining--;
    const ft = formatTime(Math.max(0, timeRemaining));
    if (timerDisplay) timerDisplay.textContent = ft;
    if (cardTimerDisplay) cardTimerDisplay.textContent = ft;
    if (timeRemaining <= 0) {
      clearInterval(timerInterval);
      triggerTimeUpModal();
    }
  }, 1000);

  if (activeQuiz.type === "spot") {
    setupVisualMode();
  } else {
    setupCardMode();
  }
}

function setupVisualMode() {
  const stage = document.getElementById("visual-stage");
  if (stage) stage.style.display = "flex";
  const scene = document.getElementById("scene");
  if (scene) scene.src = activeQuiz.image || "";
  document.querySelectorAll(".marker").forEach(m => m.remove());
  
  const rawTargets = activeQuiz.targets || [];
  const targetsArray = Array.isArray(rawTargets) ? rawTargets : Object.values(rawTargets);
  activeItems = targetsArray.map((t, i) => ({ ...t, idx: i + 1, found: false }));
  totalPossible = activeItems.length;
}

function confirmQuitQuiz() {
  const modal = document.getElementById("quit-confirm-modal");
  if (modal) modal.style.display = "flex";
}

function cancelQuitQuiz() {
  const modal = document.getElementById("quit-confirm-modal");
  if (modal) modal.style.display = "none";
}

function acceptQuitQuiz() {
  if (timerInterval) clearInterval(timerInterval);
  const quitModal = document.getElementById("quit-confirm-modal");
  const visStage = document.getElementById("visual-stage");
  const cardStage = document.getElementById("card-stage");
  if (quitModal) quitModal.style.display = "none";
  if (visStage) visStage.style.display = "none";
  if (cardStage) cardStage.style.display = "none";
}

function triggerTimeUpModal() {
  const visStage = document.getElementById("visual-stage");
  const cardStage = document.getElementById("card-stage");
  if (visStage) visStage.style.display = "none";
  if (cardStage) cardStage.style.display = "none";

  const timeupModal = document.getElementById("timeup-modal");
  if (timeupModal) timeupModal.style.display = "flex";
}

function handleTimeUpOK() {
  const timeupModal = document.getElementById("timeup-modal");
  if (timeupModal) timeupModal.style.display = "none";
  endGame(false);
}

const sceneEl = document.getElementById("scene");
if (sceneEl) {
  sceneEl.addEventListener("click", function(e) {
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
      const imgWrap = document.getElementById("img-wrap");
      if (imgWrap) imgWrap.appendChild(m);
      
      sessionDetails.push({ label: `Found ${hit.name || 'Target'}`, ok: true });
      if (scoreCount === activeItems.length) {
        setTimeout(() => endGame(true), 600);
      }
    } else { 
      misses++; 
    }
  });
}

function setupCardMode() {
  const cardStage = document.getElementById("card-stage");
  if (cardStage) cardStage.style.display = "flex";
  
  const cardTimerDisplay = document.getElementById("card-time-remaining");
  if (cardTimerDisplay) cardTimerDisplay.textContent = formatTime(timeRemaining);

  const rawPool = activeQuiz.items || activeQuiz.questions || [];
  const itemsArray = Array.isArray(rawPool) ? rawPool : Object.values(rawPool);

  let pool = JSON.parse(JSON.stringify(itemsArray));
  if (activeQuiz.randomize) pool.sort(() => Math.random() - 0.5);
  if (activeQuiz.limit > 0 && activeQuiz.limit < pool.length) pool = pool.slice(0, activeQuiz.limit);
  activeItems = pool;
  totalPossible = pool.length;
  renderCardItem();
}

function renderCardItem() {
  if (currentIndex >= activeItems.length) return endGame(true);
  const item = activeItems[currentIndex];
  
  const cardProgress = document.getElementById("card-progress");
  if (cardProgress) cardProgress.textContent = `Item ${currentIndex + 1} of ${activeItems.length}`;
  
  const cardPrompt = document.getElementById("card-prompt");
  if (cardPrompt) cardPrompt.textContent = item.q;
  
  let mediaContainer = document.getElementById("card-media-container");
  if (!mediaContainer && cardPrompt) {
    mediaContainer = document.createElement("div");
    mediaContainer.id = "card-media-container";
    mediaContainer.style.cssText = "margin-bottom: 20px; width: 100%; display: none;";
    cardPrompt.parentNode.insertBefore(mediaContainer, cardPrompt);
  }

  if (item.media && mediaContainer) {
    mediaContainer.style.display = "block";
    const mediaVal = item.media.trim();
    
    if (mediaVal.toLowerCase().includes("<iframe")) {
      let iframeHtml = mediaVal;
      if (!iframeHtml.includes("width=")) {
        iframeHtml = iframeHtml.replace("<iframe", '<iframe width="100%"');
      } else {
        iframeHtml = iframeHtml.replace(/width="[^"]*"/, 'width="100%"');
      }
      if (!iframeHtml.includes("height=")) {
        iframeHtml = iframeHtml.replace("<iframe", '<iframe height="320"');
      } else {
        iframeHtml = iframeHtml.replace(/height="[^"]*"/, 'height="320"');
      }
      if (!iframeHtml.includes("style=")) {
        iframeHtml = iframeHtml.replace("<iframe", '<iframe style="border-radius: 8px; border: 1px solid var(--border-color); background: #000;"');
      }
      mediaContainer.innerHTML = iframeHtml;
    } else {
      const ytEmbed = getYouTubeEmbedUrl(mediaVal);
      if (ytEmbed) {
        mediaContainer.innerHTML = `<iframe width="100%" height="320" src="${escapeHtml(ytEmbed)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="border-radius: 8px; border: 1px solid var(--border-color); background: #000;"></iframe>`;
      } else {
        const isVideo = mediaVal.match(/\.(mp4|webm|ogg|mov)$/i) || mediaVal.startsWith("data:video");
        if (isVideo) {
          mediaContainer.innerHTML = `<video controls autoplay style="width: 100%; max-height: 320px; border-radius: 8px; background: #000; border: 1px solid var(--border-color);"><source src="${escapeHtml(mediaVal)}" type="video/mp4">Your browser does not support video playback.</video>`;
        } else {
          mediaContainer.innerHTML = `<audio controls autoplay style="width: 100%; border-radius: 8px;"><source src="${escapeHtml(mediaVal)}" type="audio/mpeg">Your browser does not support audio playback.</audio>`;
        }
      }
    }
  } else if (mediaContainer) {
    mediaContainer.style.display = "none";
    mediaContainer.innerHTML = "";
  }

  const inter = document.getElementById("card-interactive");
  if (!inter) return;
  inter.innerHTML = "";

  const optsWithOriginalIndex = item.options.map((opt, origIdx) => ({ opt, origIdx }));
  if (activeQuiz.randomize) {
    optsWithOriginalIndex.sort(() => Math.random() - 0.5);
  }

  optsWithOriginalIndex.forEach(({ opt, origIdx }, displayIdx) => {
    const b = document.createElement("button");
    b.className = "btn-mcq-option";
    b.style.cssText = `
      width: 100%;
      background: #1e293b;
      color: #f8fafc;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px 20px;
      text-align: left;
      font-size: 15px;
      font-weight: 500;
      line-height: 1.4;
      cursor: pointer;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      transition: all 0.15s ease;
    `;
    
    const letterBadge = document.createElement("span");
    letterBadge.textContent = ["A", "B", "C", "D", "E"][displayIdx] + ".";
    letterBadge.style.cssText = `
      background: #0a101a;
      color: #38bdf8;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 13px;
      flex-shrink: 0;
      border: 1px solid var(--border-color);
    `;

    const textSpan = document.createElement("span");
    textSpan.textContent = opt;
    textSpan.style.flex = "1";

    b.appendChild(letterBadge);
    b.appendChild(textSpan);

    b.onmouseover = () => { if (!b.disabled) b.style.borderColor = "var(--accent-blue)"; };
    b.onmouseout = () => { if (!b.disabled) b.style.borderColor = "var(--border-color)"; };

    b.onclick = () => {
      const allButtons = inter.querySelectorAll("button");
      allButtons.forEach(btn => btn.disabled = true);

      const isRight = (origIdx === item.correct);
      
      if (isRight) {
        b.style.background = "rgba(22, 163, 74, 0.25)";
        b.style.borderColor = "#22c55e";
        letterBadge.style.background = "#22c55e";
        letterBadge.style.color = "#fff";
      } else {
        b.style.background = "rgba(153, 27, 27, 0.25)";
        b.style.borderColor = "#ef4444";
        letterBadge.style.background = "#ef4444";
        letterBadge.style.color = "#fff";

        allButtons.forEach(btn => {
          if (btn.getAttribute("data-is-correct") === "true") {
            btn.style.background = "rgba(22, 163, 74, 0.25)";
            btn.style.borderColor = "#22c55e";
            const badge = btn.querySelector("span");
            if (badge) {
              badge.style.background = "#22c55e";
              badge.style.color = "#fff";
            }
          }
        });
      }

      recordCardStep(isRight, `Q${currentIndex+1}: ${item.q.substring(0,25)}...`);
      
      setTimeout(() => {
        currentIndex++;
        renderCardItem();
      }, 900);
    };

    if (origIdx === item.correct) {
      b.setAttribute("data-is-correct", "true");
    }

    inter.appendChild(b);
  });
}

function recordCardStep(isRight, labelText) {
  if (isRight) scoreCount++; else misses++;
  sessionDetails.push({ label: labelText, ok: isRight });
}

function addQuestionFromBuilder() {
  const qText = document.getElementById("builder-q-text").value.trim();
  const opt0 = document.getElementById("builder-opt-0").value.trim();
  const opt1 = document.getElementById("builder-opt-1").value.trim();
  const opt2 = document.getElementById("builder-opt-2").value.trim();
  const opt3 = document.getElementById("builder-opt-3").value.trim();
  const correctIdx = parseInt(document.getElementById("builder-correct-idx").value);
  const mediaInput = document.getElementById("builder-media-input").value.trim();

  if (!qText) return alert("Please enter the question text!");
  if (!opt0 || !opt1) return alert("Please provide at least Option A and Option B!");

  const options = [opt0, opt1];
  if (opt2) options.push(opt2);
  if (opt3) options.push(opt3);

  if (correctIdx >= options.length) {
    return alert("The selected correct answer corresponds to an empty option. Please fill in that option or select a valid correct answer.");
  }

  if (editingQuestionIndex === null) {
    const normalizedNew = normalizeQuestionText(qText);
    const isDuplicate = parsedDocItems.some(item => normalizeQuestionText(item.q) === normalizedNew);
    if (isDuplicate) {
      return alert("⚠️ A question with this exact text already exists in the question bank!");
    }
  }

  const updatedQuestion = {
    q: qText,
    options: options,
    correct: correctIdx,
    media: mediaInput || ""
  };

  if (editingQuestionIndex !== null) {
    parsedDocItems[editingQuestionIndex] = updatedQuestion;
    editingQuestionIndex = null;
    
    const addBtn = document.querySelector("#studio-pane-2 .btn-start");
    if (addBtn) {
      addBtn.innerHTML = `<i class="fas fa-check"></i> Add Question to Bank`;
      addBtn.style.background = "var(--accent-blue)";
      addBtn.style.color = "#fff";
    }
  } else {
    parsedDocItems.push(updatedQuestion);
  }

  document.getElementById("builder-q-text").value = "";
  document.getElementById("builder-opt-0").value = "";
  document.getElementById("builder-opt-1").value = "";
  document.getElementById("builder-opt-2").value = "";
  document.getElementById("builder-opt-3").value = "";
  document.getElementById("builder-correct-idx").value = "0";
  document.getElementById("builder-media-input").value = "";

  renderBuilderQuestionList();
  updateLivePreview();
}

function renderBuilderQuestionList() {
  const countEl = document.getElementById("doc-count");
  if (countEl) countEl.textContent = parsedDocItems.length;
  const listEl = document.getElementById("doc-preview-list");
  if (!listEl) return;
  
  if (parsedDocItems.length === 0) {
    listEl.innerHTML = "No questions created yet. Use the form above to add questions.";
    return;
  }

  listEl.innerHTML = parsedDocItems.map((it, i) => `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 10px; margin-bottom: 8px; background: #070c14; border-radius: 6px; border: 1px solid var(--border-color);">
      <div>
        <strong style="color: #38bdf8;">Q${i+1}:</strong> ${escapeHtml(it.q)}
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
          Options: ${it.options.length} | Correct: Option ${["A","B","C","D"][it.correct]} ${it.media ? '| 🎬 Media: ' + escapeHtml(it.media) : ''}
        </div>
      </div>
      <div style="display: flex; gap: 6px; flex-shrink: 0;">
        <button class="btn" style="padding: 4px 8px; font-size: 11px; background: #1e293b; color: var(--accent-yellow); border: 1px solid var(--border-color); border-radius: 4px;" onclick="editBuilderQuestion(${i})">✏️ Edit</button>
        <button class="btn" style="padding: 4px 8px; font-size: 11px; background: #991b1b; color: #fff; border: none; border-radius: 4px;" onclick="deleteBuilderQuestion(${i})">🗑️ Delete</button>
      </div>
    </div>
  `).join("");
}

function editBuilderQuestion(index) {
  const item = parsedDocItems[index];
  if (!item) return;

  document.getElementById("builder-q-text").value = item.q || "";
  document.getElementById("builder-opt-0").value = item.options[0] || "";
  document.getElementById("builder-opt-1").value = item.options[1] || "";
  document.getElementById("builder-opt-2").value = item.options[2] || "";
  document.getElementById("builder-opt-3").value = item.options[3] || "";
  document.getElementById("builder-correct-idx").value = item.correct || 0;
  document.getElementById("builder-media-input").value = item.media || "";

  editingQuestionIndex = index;

  const addBtn = document.querySelector("#studio-pane-2 .btn-start");
  if (addBtn) {
    addBtn.innerHTML = `<i class="fas fa-save"></i> Update Question in Bank`;
    addBtn.style.background = "var(--accent-yellow)";
    addBtn.style.color = "#0a101a";
  }

  document.getElementById("builder-q-text").scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function deleteBuilderQuestion(index) {
  parsedDocItems.splice(index, 1);
  if (editingQuestionIndex === index) {
    editingQuestionIndex = null;
    const addBtn = document.querySelector("#studio-pane-2 .btn-start");
    if (addBtn) {
      addBtn.innerHTML = `<i class="fas fa-check"></i> Add Question to Bank`;
      addBtn.style.background = "var(--accent-blue)";
      addBtn.style.color = "#fff";
    }
  } else if (editingQuestionIndex > index) {
    editingQuestionIndex--;
  }
  renderBuilderQuestionList();
  updateLivePreview();
}

function exportQuestionBank() {
  if (parsedDocItems.length === 0) return alert("The question bank is currently empty!");
  
  let exportText = "";
  parsedDocItems.forEach((it, i) => {
    exportText += `Q${i+1}: ${it.q}\n`;
    if (it.media) {
      exportText += `MEDIA: ${it.media}\n`;
    }
    it.options.forEach((opt, optIdx) => {
      const letter = ["A", "B", "C", "D", "E"][optIdx];
      const prefix = (optIdx === it.correct) ? `*${letter})` : `${letter})`;
      exportText += `${prefix} ${opt}\n`;
    });
    exportText += `\n`;
  });

  const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Question_Bank_Export.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleDocxUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.name.endsWith(".txt")) {
    const r = new FileReader();
    r.onload = (ev) => { 
      document.getElementById("raw-text-input").value = ev.target.result; 
    };
    r.readAsText(file);
  } else {
    const r = new FileReader();
    r.onload = (ev) => {
      mammoth.extractRawText({ arrayBuffer: ev.target.result }).then(res => {
        document.getElementById("raw-text-input").value = res.value;
      });
    };
    r.readAsArrayBuffer(file);
  }
}

function parseCurrentDocText() {
  const raw = document.getElementById("raw-text-input").value.trim();
  if (!raw) return alert("Please type or paste raw text questions first!");
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
  let tempItems = [];
  let cur = null;
  let pendingMedia = "";

  lines.forEach(line => {
    if (line.toUpperCase().startsWith("MEDIA:")) {
      pendingMedia = line.substring(6).trim();
      return;
    }
    const optMatch = line.match(/^(\*)?([A-E])[\)\.\:]\s*(.+)/i);
    if (optMatch && cur) {
      if (optMatch[1]) cur.correct = cur.options.length;
      cur.options.push(optMatch[3].trim());
      return;
    }
    if (cur && cur.options.length >= 2) tempItems.push(cur);
    cur = { q: line.replace(/^(?:Q\d*|Question\s*\d*|\d+)[\:\.\)]\s*/i, ""), options: [], correct: 0, media: pendingMedia };
    pendingMedia = "";
  });
  if (cur && cur.options.length >= 2) tempItems.push(cur);

  let addedCount = 0;
  tempItems.forEach(newItem => {
    const normNew = normalizeQuestionText(newItem.q);
    const exists = parsedDocItems.some(existing => normalizeQuestionText(existing.q) === normNew);
    if (!exists) {
      parsedDocItems.push(newItem);
      addedCount++;
    }
  });

  renderBuilderQuestionList();
  updateLivePreview();
  
  if (addedCount > 0) {
    alert(`Successfully appended ${addedCount} new unique question(s) to the bank! (Duplicates were skipped)`);
    document.getElementById("raw-text-input").value = "";
  } else {
    alert("No new unique questions found to append (all parsed questions already exist in the bank).");
  }
}

function endGame(completedAll) {
  if (timerInterval) clearInterval(timerInterval); 
  document.querySelectorAll(".overlay").forEach(o => o.style.display = "none");
  const endScreen = document.getElementById("end-screen");
  if (endScreen) endScreen.style.display = "flex";
  
  const endTitle = document.getElementById("end-title");
  if (endTitle) endTitle.textContent = completedAll ? "🏆 Challenge Complete!" : "⏱️ Assessment Finished!";

  const totalTimeAllowed = activeQuiz ? (parseInt(activeQuiz.timeLimit) || 60) : 60;
  const timeTaken = totalTimeAllowed - Math.max(0, timeRemaining);

  const previewTableBody = document.getElementById("leaderboard-body");

  if (isPreviewMode) {
    if (previewTableBody) {
      previewTableBody.innerHTML = `
        <tr style="background: rgba(0, 150, 255, 0.15); font-weight: 700;">
          <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);">1</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);">${escapeHtml(playerName)} (Preview)</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);">${scoreCount}/${totalPossible} (${formatTime(timeTaken)})</td>
        </tr>
      `;
    }
    isPreviewMode = false;
    return;
  }

  const scorePayload = {
    id: currentSessionId, 
    name: playerName, 
    found: scoreCount, 
    total: totalPossible,
    time: timeTaken, 
    misses: misses, 
    details: sessionDetails, 
    timestamp: Date.now()
  };

  allScoresRef.child(activeQuiz.id).push(scorePayload).then(() => {
    allScoresRef.child(activeQuiz.id).once('value', (snap) => {
      const data = snap.val();
      const tbody = document.getElementById("leaderboard-body");
      if (!data || !tbody) return;

      const scores = Object.values(data);
      scores.sort((a, b) => b.found !== a.found ? b.found - a.found : (a.time !== b.time ? a.time - b.time : a.misses - b.misses));

      tbody.innerHTML = scores.map((s, i) => {
        const isCurrent = s.id === currentSessionId;
        const rowStyle = isCurrent ? 'background: rgba(0, 150, 255, 0.15); font-weight: 700;' : '';
        return `
          <tr style="${rowStyle}">
            <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);">${i + 1}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);">${escapeHtml(s.name)} ${isCurrent ? '(You)' : ''}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);">${s.found}/${s.total || totalPossible} (${formatTime(s.time)})</td>
          </tr>
        `;
      }).join("");
    });
  });
}

function openLeaderboardOnly() {
  if (!activeQuiz) return alert("Please select a quiz from the dropdown menu first!");
  const endScreen = document.getElementById("end-screen");
  if (endScreen) endScreen.style.display = "flex";
  
  const endTitle = document.getElementById("end-title");
  if (endTitle) endTitle.textContent = `🏆 ${activeQuiz.title}`;

  allScoresRef.child(activeQuiz.id).once('value', (snap) => {
    const data = snap.val();
    const tbody = document.getElementById("leaderboard-body");
    if (!tbody) return;
    if (!data) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:24px; color:var(--text-muted);">No scores recorded yet.</td></tr>`;
      return;
    }

    const scores = Object.values(data);
    scores.sort((a, b) => b.found !== a.found ? b.found - a.found : (a.time !== b.time ? a.time - b.time : a.misses - b.misses));

    tbody.innerHTML = scores.map((s, i) => `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);">${i + 1}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);">${escapeHtml(s.name)}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);">${s.found}/${s.total || 10} (${formatTime(s.time)})</td>
      </tr>
    `).join("");
  });
}

function openStudio() {
  const studentView = document.getElementById("student-view");
  const studioView = document.getElementById("studio-view");
  if (studentView) studentView.style.display = "none";
  if (studioView) studioView.style.display = "flex";

  if (!editingQuizId && parsedDocItems.length === 0 && builderTargets.length === 0) {
    startNewQuiz();
  }
}

function closeStudio() {
  const studentView = document.getElementById("student-view");
  const studioView = document.getElementById("studio-view");
  if (studioView) studioView.style.display = "none";
  if (studentView) studentView.style.display = "block";
}

function switchBuilderType() {
  const type = document.getElementById("build-type").value;
  const hintEl = document.getElementById("build-type-hint");
  
  const hints = {
    spot: "Students identify and click on hidden targets within an image.",
    mcq: "Students answer multiple-choice questions created directly or from text banks with instant feedback."
  };
  if (hintEl) hintEl.textContent = hints[type] || "Configure your training module settings.";

  if (currentStudioStepNum === 2) {
    const isImg = (type === "spot");
    const docBox = document.getElementById("step2-doc-box");
    const imgBox = document.getElementById("step2-img-box");
    if (docBox) docBox.style.display = isImg ? "none" : "block";
    if (imgBox) imgBox.style.display = isImg ? "block" : "none";
  }
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

  const navCreate = document.getElementById("nav-create");
  const navMyQuizzes = document.getElementById("nav-myquizzes");
  if (navCreate) navCreate.classList.remove("active");
  if (navMyQuizzes) navMyQuizzes.classList.remove("active");
  if (stepNum >= 1 && stepNum <= 5) {
    if (navCreate) navCreate.classList.add("active");
  }

  const titles = {
    1: ["Create New Quiz", "Follow the steps below to create a training quiz for your students."],
    2: ["Add Content", "Create questions directly or upload source files."],
    3: ["Game Settings", "Configure timing, scoring penalties, and randomization rules."],
    4: ["Review & Test", "Check your quiz details and preview functionality."],
    5: ["Publish Live", "Make this assessment instantly available to the classroom."]
  };
  const mainHeading = document.getElementById("studio-main-heading");
  const mainSub = document.getElementById("studio-main-sub");
  if (mainHeading) mainHeading.textContent = titles[stepNum][0];
  if (mainSub) mainSub.textContent = titles[stepNum][1];

  const nextBtn = document.getElementById("studio-next-btn");
  if (nextBtn) {
    if (stepNum === 5) {
      nextBtn.innerHTML = editingQuizId ? `Update Quiz Live <i class="fas fa-rocket"></i>` : `Publish Live <i class="fas fa-rocket"></i>`;
      nextBtn.onclick = publishQuiz;
    } else {
      const nextLabels = { 1: "Next: Add Content", 2: "Next: Game Settings", 3: "Next: Review", 4: "Next: Publish" };
      nextBtn.innerHTML = `${nextLabels[stepNum]} <i class="fas fa-arrow-right"></i>`;
      nextBtn.onclick = nextStudioStep;
    }
  }

  if (stepNum === 2) {
    const type = document.getElementById("build-type").value;
    const isImg = (type === "spot");
    const docBox = document.getElementById("step2-doc-box");
    const imgBox = document.getElementById("step2-img-box");
    if (docBox) docBox.style.display = isImg ? "none" : "block";
    if (imgBox) imgBox.style.display = isImg ? "block" : "none";
    if (isImg) {
      const mapImgEl = document.getElementById("step2-map-img");
      if (mapImgEl) {
        if (uploadedBase64Image) {
          mapImgEl.src = uploadedBase64Image;
        } else {
          mapImgEl.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        }
      }
      renderStep2Markers();
      renderStep2TargetList();
    }
  } else if (stepNum === 4) {
    const timeMins = document.getElementById("set-time") ? document.getElementById("set-time").value : 1;
    const revTitle = document.getElementById("rev-title");
    const revDesc = document.getElementById("rev-desc");
    const revStats = document.getElementById("rev-stats");
    const buildTitle = document.getElementById("build-title");
    const buildDesc = document.getElementById("build-desc");
    const buildType = document.getElementById("build-type");
    const buildDiff = document.getElementById("build-diff");

    if (revTitle && buildTitle) revTitle.textContent = buildTitle.value || "Untitled Quiz";
    if (revDesc && buildDesc) revDesc.textContent = buildDesc.value || "";
    if (revStats && buildType && buildDiff) {
      revStats.textContent = `Type: ${buildType.value.toUpperCase()} • Time: ${timeMins} Mins • Difficulty: ${buildDiff.value}`;
    }
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
  const buildDiff = document.getElementById("build-diff");
  if (buildDiff) buildDiff.value = level;
  updateLivePreview();
}

function updateLivePreview() {
  const titleEl = document.getElementById("build-title");
  const descEl = document.getElementById("build-desc");
  const timeEl = document.getElementById("set-time");
  const diffEl = document.getElementById("build-diff");
  const objEl = document.getElementById("build-obj");
  const typeEl = document.getElementById("build-type");

  const title = titleEl ? (titleEl.value || "Untitled Quiz") : "Untitled Quiz";
  const desc = descEl ? (descEl.value || "Short description will appear here...") : "Short description will appear here...";
  const quizType = typeEl ? typeEl.value : "spot";
  
  const qcount = (quizType === "mcq") ? parsedDocItems.length : (builderTargets.length > 0 ? builderTargets.length : (parsedDocItems.length > 0 ? parsedDocItems.length : 0));
  const timeMins = timeEl ? timeEl.value : 1;
  const diff = diffEl ? (diffEl.value || "Beginner") : "Beginner";
  const obj = objEl ? (objEl.value || "Learning objective will appear here...") : "Learning objective will appear here...";

  const prevTitle = document.getElementById("prev-card-title");
  const prevDesc = document.getElementById("prev-card-desc");
  const prevDiff = document.getElementById("prev-card-diff");
  const prevQcount = document.getElementById("prev-card-qcount");
  const prevTime = document.getElementById("prev-card-time");
  const prevDiffLbl = document.getElementById("prev-card-diff-lbl");
  const prevObj = document.getElementById("prev-card-obj");
  const titleCount = document.getElementById("title-char-count");
  const descCount = document.getElementById("desc-char-count");
  const objCount = document.getElementById("obj-char-count");

  if (prevTitle) prevTitle.textContent = title;
  if (prevDesc) prevDesc.textContent = desc;
  if (prevDiff) prevDiff.textContent = diff.toUpperCase();
  if (prevQcount) prevQcount.textContent = qcount;
  if (prevTime) prevTime.textContent = `${timeMins} Mins`;
  if (prevDiffLbl) prevDiffLbl.textContent = diff;
  if (prevObj) prevObj.textContent = obj;

  if (titleCount && titleEl) titleCount.textContent = `${titleEl.value.length}/80`;
  if (descCount && descEl) descCount.textContent = `${descEl.value.length}/200`;
  if (objCount && objEl) objCount.textContent = `${objEl.value.length}/300`;
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
      
      const builderImg = document.getElementById("builder-img");
      const builderWrap = document.getElementById("builder-canvas-wrap");
      const prevCardImg = document.getElementById("prev-card-img");
      const step2MapImg = document.getElementById("step2-map-img");

      if (builderImg) builderImg.src = uploadedBase64Image;
      if (builderWrap) builderWrap.style.display = "inline-block";
      if (prevCardImg) prevCardImg.src = uploadedBase64Image;
      if (step2MapImg) step2MapImg.src = uploadedBase64Image;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function startRepositionTarget(id) {
  repositionTargetId = id;
  const inst = document.getElementById("mapping-instruction");
  if (inst) {
    inst.innerHTML = `<span style="color: var(--accent-yellow); font-weight: 700;">Repositioning Target #${id}—click new location on the image above.</span>`;
  }
}

function deleteTarget(id) {
  builderTargets = builderTargets.filter(t => t.id !== parseInt(id));
  builderTargets.forEach((t, index) => {
    t.id = index + 1;
    t.name = `Target ${t.id}`;
  });
  const spotCount = document.getElementById("step2-spot-count");
  if (spotCount) spotCount.textContent = builderTargets.length;
  renderStep2Markers();
  renderStep2TargetList();
  updateLivePreview();
}

function onStep2MapClick(e) {
  const rect = e.target.getBoundingClientRect();
  const x = parseFloat((((e.clientX - rect.left) / rect.width) * 100).toFixed(1));
  const y = parseFloat((((e.clientY - rect.top) / rect.height) * 100).toFixed(1));
  
  if (repositionTargetId !== null) {
    const target = builderTargets.find(t => t.id === repositionTargetId);
    if (target) {
      target.x = x;
      target.y = y;
    }
    repositionTargetId = null;
    const inst = document.getElementById("mapping-instruction");
    if (inst) {
      inst.textContent = "Click directly on the challenge image below to drop target zones.";
    }
  } else {
    const newId = builderTargets.length + 1;
    const defaultName = `Target ${newId}`;
    const defaultRadius = 6;

    builderTargets.push({ id: newId, name: defaultName, x, y, r: defaultRadius });
  }

  const spotCount = document.getElementById("step2-spot-count");
  if (spotCount) spotCount.textContent = builderTargets.length;
  renderStep2Markers();
  renderStep2TargetList();
  updateLivePreview();
}

function updateTargetRadius(targetId, newRadius) {
  const target = builderTargets.find(t => t.id === parseInt(targetId));
  if (target) {
    target.r = parseInt(newRadius);
    renderStep2Markers();
  }
}

function renderStep2Markers() {
  const wrap = document.getElementById("step2-canvas-wrap");
  if (!wrap) return;
  wrap.querySelectorAll(".map-marker").forEach(m => m.remove());

  builderTargets.forEach(t => {
    const m = document.createElement("div");
    m.className = "map-marker";
    m.textContent = t.id;
    m.style.left = t.x + "%";
    m.style.top = t.y + "%";
    m.style.width = ((t.r || 6) * 2) + "%";
    m.style.aspectRatio = "1/1";
    wrap.appendChild(m);
  });
}

function renderStep2TargetList() {
  const listEl = document.getElementById("step2-spot-preview-list");
  if (!listEl) return;

  if (builderTargets.length === 0) {
    listEl.innerHTML = "No target points mapped yet. Click on the image above.";
    return;
  }

  listEl.innerHTML = builderTargets.map(t => `
    <div style="display: flex; flex-direction: column; gap: 6px; padding: 10px; margin-bottom: 8px; background: #070c14; border-radius: 6px; border: 1px solid var(--border-color);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600; color: #fff;">#${t.id}: ${escapeHtml(t.name)} (${t.x}%, ${t.y}%)</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn" style="padding: 4px 10px; font-size: 11px; background: #1e293b; color: var(--accent-yellow); border: 1px solid var(--border-color); border-radius: 4px;" onclick="startRepositionTarget(${t.id})">📍 Reposition</button>
          <button class="btn" style="padding: 4px 10px; font-size: 11px; background: #991b1b; color: #fff; border: none; border-radius: 4px;" onclick="deleteTarget(${t.id})">🗑️ Delete</button>
          <span style="font-size: 11px; color: var(--accent-blue);">Radius: <span id="r-lbl-${t.id}">${t.r || 6}</span>%</span>
        </div>
      </div>
      <input type="range" min="3" max="18" value="${t.r || 6}" style="width: 100%; accent-color: var(--accent-blue);" oninput="document.getElementById('r-lbl-${t.id}').textContent = this.value; updateTargetRadius(${t.id}, this.value)" />
    </div>
  `).join("");
}

function publishQuiz() {
  const titleInput = document.getElementById("build-title");
  let title = titleInput ? titleInput.value.trim() : "";
  const typeInput = document.getElementById("build-type");
  const type = typeInput ? typeInput.value : "spot";
  if (!title) return alert("Please enter a Quiz Title!");

  title = title.replace(/\s*\(DRAFT\)$/i, "").trim();
  if (titleInput) titleInput.value = title;

  const timeInput = document.getElementById("set-time");
  const timeMins = parseFloat(timeInput ? timeInput.value : 1) || 1;

  const descInput = document.getElementById("build-desc");
  const diffInput = document.getElementById("build-diff");
  const objInput = document.getElementById("build-obj");
  const limitInput = document.getElementById("set-limit");
  const randomInput = document.getElementById("set-random");

  const payload = {
    title, type,
    timeLimit: Math.round(timeMins * 60),
    description: descInput ? descInput.value.trim() : "Training assessment module.",
    qtype: type === 'mcq' ? 'Multiple Choice' : 'Spot the Object',
    difficulty: diffInput ? diffInput.value : "Beginner",
    objective: objInput ? objInput.value.trim() : "Reinforce classroom learning objectives.",
    image: uploadedBase64Image || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    targets: builderTargets.length > 0 ? builderTargets : [{ id: 1, name: "Target 1", x: 50, y: 50, r: 6 }],
    items: parsedDocItems,
    randomize: randomInput ? randomInput.checked : true,
    limit: limitInput ? parseInt(limitInput.value) || 0 : 0,
    isDraft: false,
    createdAt: Date.now()
  };

  const savePromise = editingQuizId 
    ? quizzesRef.child(editingQuizId).set(payload) 
    : quizzesRef.push(payload).then(ref => ref.key);

  savePromise.then((key) => {
    alert(editingQuizId ? "🎉 Quiz Published Live!" : "🎉 Quiz Published Live to Classroom Hub!");
    const targetKey = editingQuizId || key;
    editingQuizId = null;
    closeStudio();
    const quizSel = document.getElementById("quiz-selector");
    if (quizSel) quizSel.value = targetKey;
    onQuizSelectChange();
  });
}

function saveAsDraft() {
  const titleInput = document.getElementById("build-title");
  let title = titleInput ? titleInput.value.trim() : "";
  const typeInput = document.getElementById("build-type");
  const type = typeInput ? typeInput.value : "spot";
  if (!title) return alert("Please enter a Quiz Title before saving as draft!");

  if (!/\(DRAFT\)$/i.test(title)) {
    title += " (DRAFT)";
  }
  if (titleInput) titleInput.value = title;

  const timeInput = document.getElementById("set-time");
  const timeMins = parseFloat(timeInput ? timeInput.value : 1) || 1;

  const descInput = document.getElementById("build-desc");
  const diffInput = document.getElementById("build-diff");
  const objInput = document.getElementById("build-obj");
  const limitInput = document.getElementById("set-limit");
  const randomInput = document.getElementById("set-random");

  const payload = {
    title, type,
    timeLimit: Math.round(timeMins * 60),
    description: descInput ? descInput.value.trim() : "Training assessment module.",
    qtype: type === 'mcq' ? 'Multiple Choice' : 'Spot the Object',
    difficulty: diffInput ? diffInput.value : "Beginner",
    objective: objInput ? objInput.value.trim() : "Reinforce classroom learning objectives.",
    image: uploadedBase64Image || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    targets: builderTargets.length > 0 ? builderTargets : [{ id: 1, name: "Target 1", x: 50, y: 50, r: 6 }],
    items: parsedDocItems,
    randomize: randomInput ? randomInput.checked : true,
    limit: limitInput ? parseInt(limitInput.value) || 0 : 0,
    isDraft: true,
    createdAt: Date.now()
  };

  const savePromise = editingQuizId 
    ? quizzesRef.child(editingQuizId).set(payload) 
    : quizzesRef.push(payload).then(ref => ref.key);

  savePromise.then((key) => {
    if (!editingQuizId) editingQuizId = key;
    const badge = document.getElementById("draft-saved-badge");
    if (badge) {
      badge.style.display = "flex";
      setTimeout(() => { badge.style.display = "none"; }, 4000);
    }
    onQuizSelectChange();
  });
}

function openDeleteManager() {
  const modal = document.getElementById("delete-manager-modal");
  const navMyQuizzes = document.getElementById("nav-myquizzes");
  const navCreate = document.getElementById("nav-create");

  if (navCreate) navCreate.classList.remove("active");
  if (navMyQuizzes) navMyQuizzes.classList.add("active");

  if (modal) {
    modal.style.display = "flex";
    renderDeleteQuizList();
  }
}

function closeDeleteManager() {
  const modal = document.getElementById("delete-manager-modal");
  const navMyQuizzes = document.getElementById("nav-myquizzes");
  const navCreate = document.getElementById("nav-create");

  if (navMyQuizzes) navMyQuizzes.classList.remove("active");
  if (navCreate) navCreate.classList.add("active");

  if (modal) {
    modal.style.display = "none";
  }
}

function loadQuizForEdit(quizId) {
  const q = availableQuizzes[quizId];
  if (!q) return alert("Quiz not found.");

  closeDeleteManager();
  openStudio();
  editingQuizId = quizId;

  const buildTitle = document.getElementById("build-title");
  if (buildTitle) buildTitle.value = q.title || "";
  
  const buildDesc = document.getElementById("build-desc");
  if (buildDesc) buildDesc.value = q.description || "";
  
  const buildObj = document.getElementById("build-obj");
  if (buildObj) buildObj.value = q.objective || "";
  
  const buildType = document.getElementById("build-type");
  if (buildType) buildType.value = q.type || "spot";
  
  const timeLimitSecs = q.timeLimit || 60;
  const setTime = document.getElementById("set-time");
  if (setTime) setTime.value = (timeLimitSecs / 60);

  const setLimit = document.getElementById("set-limit");
  if (setLimit) setLimit.value = q.limit || 0;
  
  const setRandom = document.getElementById("set-random");
  if (setRandom) {
    setRandom.checked = q.randomize !== false;
  }

  const diff = q.difficulty || "Beginner";
  const buildDiff = document.getElementById("build-diff");
  if (buildDiff) buildDiff.value = diff;
  
  document.querySelectorAll(".diff-card").forEach(c => {
    if (c.textContent.includes(diff) || (diff === "Beginner" && c.textContent.includes("Easy")) || (diff === "Advanced" && c.textContent.includes("Hard"))) {
      c.classList.add("selected");
    } else {
      c.classList.remove("selected");
    }
  });

  uploadedBase64Image = q.image || "";
  if (uploadedBase64Image) {
    const builderImg = document.getElementById("builder-img");
    const builderWrap = document.getElementById("builder-canvas-wrap");
    const step2MapImg = document.getElementById("step2-map-img");
    const prevCardImg = document.getElementById("prev-card-img");

    if (builderImg) builderImg.src = uploadedBase64Image;
    if (builderWrap) builderWrap.style.display = "inline-block";
    if (step2MapImg) step2MapImg.src = uploadedBase64Image;
    if (prevCardImg) prevCardImg.src = uploadedBase64Image;
  }

  const rawTargets = q.targets || [];
  builderTargets = Array.isArray(rawTargets) ? JSON.parse(JSON.stringify(rawTargets)) : Object.values(rawTargets);

  const rawItems = q.items || q.questions || [];
  parsedDocItems = Array.isArray(rawItems) ? JSON.parse(JSON.stringify(rawItems)) : Object.values(rawItems);

  const spotCount = document.getElementById("step2-spot-count");
  if (spotCount) spotCount.textContent = builderTargets.length;
  
  switchStudioStep(1);
  renderBuilderQuestionList();
  switchBuilderType();
  updateLivePreview();
}

function renderDeleteQuizList() {
  const listEl = document.getElementById("delete-quiz-list");
  if (!listEl) return;
  const custom = Object.values(availableQuizzes);
  listEl.innerHTML = custom.length === 0 ? `<div style="padding:16px; text-align:center; color:var(--text-muted);">No custom quizzes found.</div>` :
    custom.map(q => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:8px; border-bottom:1px solid #1e293b;">
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer; flex:1; margin:0; overflow:hidden; text-overflow:ellipsis;">
          <input type="checkbox" class="quiz-del-cb" value="${q.id}" onchange="updateDeleteCount()" style="width:16px; height:16px; margin:0; flex-shrink:0;" /> 
          <span style="color:#fff; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(q.title)}</span>
        </label>
        <div style="display:flex; gap:6px; flex-shrink:0; margin-left:8px;">
          <button class="btn" style="padding: 4px 10px; font-size: 11px; background: #1e293b; color: var(--accent-yellow); border: 1px solid var(--border-color); border-radius: 4px;" onclick="clearScoreboard('${q.id}', '${escapeHtml(q.title).replace(/'/g, "\\'")}')">🧹 Clear</button>
          <button class="btn" style="padding: 4px 10px; font-size: 11px; background: #1e293b; color: var(--accent-blue); border: 1px solid var(--border-color); border-radius: 4px;" onclick="loadQuizForEdit('${q.id}')">✏️ Edit</button>
        </div>
      </div>
    `).join("");
  updateDeleteCount();
}

function clearScoreboard(quizId, quizTitle) {
  if (!confirm(`Are you sure you want to clear all high scores and leaderboard records for "${quizTitle}"?`)) return;
  
  allScoresRef.child(quizId).remove().then(() => {
    alert(`Scoreboard for "${quizTitle}" has been cleared successfully.`);
  }).catch((error) => {
    alert("Failed to clear scoreboard: " + error.message);
  });
}

function deleteSelectedQuizzesBatch() {
  const checked = Array.from(document.querySelectorAll(".quiz-del-cb:checked"));
  if (checked.length === 0) return alert("Select at least one quiz.");
  if (prompt("Type DELETE to confirm:") !== "DELETE") return;
  const updates = {};
  checked.forEach(cb => { updates[`quizzes/${cb.value}`] = null; updates[`quiz_scores/${cb.value}`] = null; });
  db.ref().update(updates).then(() => { alert("Deleted successfully."); closeDeleteManager(); });
}

function toggleSelectAllQuizzes(isChecked) {
  document.querySelectorAll(".quiz-del-cb").forEach(cb => cb.checked = isChecked);
  updateDeleteCount();
}

function updateDeleteCount() {
  const count = document.querySelectorAll(".quiz-del-cb:checked").length;
  const countEl = document.getElementById("selected-delete-count");
  if (countEl) countEl.textContent = `${count} selected`;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function startNewQuiz() {
  const currentTitle = document.getElementById("build-title") ? document.getElementById("build-title").value.trim() : "";
  const hasUnsavedContent = parsedDocItems.length > 0 || builderTargets.length > 0 || currentTitle !== "";

  if (hasUnsavedContent && !editingQuizId) {
    const saveChoice = confirm("You have active questions or details in the current builder. Would you like to save this quiz as a draft before starting a new one?");
    if (saveChoice) {
      saveAsDraft();
      return;
    } else {
      const discardChoice = confirm("Are you sure you want to discard your current work and start a new quiz?");
      if (!discardChoice) return;
    }
  }

  editingQuizId = null;
  editingQuestionIndex = null;
  
  const buildTitle = document.getElementById("build-title");
  if (buildTitle) buildTitle.value = "";
  
  const buildDesc = document.getElementById("build-desc");
  if (buildDesc) buildDesc.value = "";
  
  const buildObj = document.getElementById("build-obj");
  if (buildObj) buildObj.value = "";
  
  const buildType = document.getElementById("build-type");
  if (buildType) buildType.value = "spot";
  
  const setTime = document.getElementById("set-time");
  if (setTime) setTime.value = "1";
  
  const setLimit = document.getElementById("set-limit");
  if (setLimit) setLimit.value = "0";
  
  const setRandom = document.getElementById("set-random");
  if (setRandom) setRandom.checked = true;
  
  const imgUpload = document.getElementById("img-upload");
  if (imgUpload) imgUpload.value = "";
  
  const canvasWrap = document.getElementById("builder-canvas-wrap");
  if (canvasWrap) canvasWrap.style.display = "none";
  
  const emptyImgSrc = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  uploadedBase64Image = "";
  
  const prevCardImg = document.getElementById("prev-card-img");
  if (prevCardImg) prevCardImg.src = emptyImgSrc;
  
  const builderImg = document.getElementById("builder-img");
  if (builderImg) builderImg.src = emptyImgSrc;
  
  const step2MapImg = document.getElementById("step2-map-img");
  if (step2MapImg) step2MapImg.src = emptyImgSrc;

  const badge = document.getElementById("draft-saved-badge");
  if (badge) badge.style.display = "none";

  builderTargets = [];
  parsedDocItems = [];
  repositionTargetId = null;

  const addBtn = document.querySelector("#studio-pane-2 .btn-start");
  if (addBtn) {
    addBtn.innerHTML = `<i class="fas fa-check"></i> Add Question to Bank`;
    addBtn.style.background = "var(--accent-blue)";
    addBtn.style.color = "#fff";
  }

  renderBuilderQuestionList();
  switchStudioStep(1);
  switchBuilderType();
  updateLivePreview();
}