// ---------- Helpers ----------
const $ = function (id) { return document.getElementById(id); };
// $("x") is a shortcut for document.getElementById("x")

function el(tag, className, text) {
  // Builds an element in one line: tag, optional class, optional text.
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function todayStr() {
  // Today's date as YYYY-MM-DD in YOUR local time zone.
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

const COLORS = ["#7c3aed", "#ec4899", "#2563eb", "#16a34a", "#f59e0b", "#0ea5e9", "#ef4444"];

// ---------- Data ----------
// state = { target: 75, subjects: [ {id, name, color, target, baseAttended,
//           baseTotal, remaining, log: [ {date, status} ] } ] }
function load() {
  try {
    return JSON.parse(localStorage.getItem("attendanceV2")) || { target: 75, subjects: [] };
  } catch (e) {
    return { target: 75, subjects: [] };   // saved data was corrupted
  }
}

let state = load();

function save() {
  localStorage.setItem("attendanceV2", JSON.stringify(state));
}

// ---------- Maths ----------
function stats(sub) {
  // Starting numbers + everything in the log. Cancelled classes are ignored.
  let attended = sub.baseAttended;
  let total = sub.baseTotal;
  sub.log.forEach(function (entry) {
    if (entry.status === "present") { attended++; total++; }
    else if (entry.status === "absent") { total++; }
  });
  return { attended: attended, total: total };
}

function targetOf(sub) {
  return sub.target || state.target;   // own target, else the default
}

function streak(sub) {
  // Count back from the latest entry while the student was present.
  const sorted = sub.log
    .filter(function (e) { return e.status !== "cancelled"; })
    .sort(function (a, b) { return a.date.localeCompare(b.date); });
  let count = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].status === "present") count++;
    else break;
  }
  return count;
}

function analyse(attended, total, target) {
  if (total === 0) return { percent: 0, safe: true, message: "No classes yet." };

  const percent = (attended / total) * 100;

  if (percent >= target) {
    // Solve attended / (total + x) >= target/100 for x (classes I can skip)
    const canSkip = target >= 100 ? 0 : Math.floor((attended * 100) / target - total + 1e-9);
    return {
      percent: percent,
      safe: true,
      message: canSkip > 0
        ? "✅ You can skip " + canSkip + " more class(es) and stay safe."
        : "⚠️ Right on the edge. Don't skip any class!"
    };
  }

  if (target >= 100) return { percent: percent, safe: false, message: "❌ 100% is no longer possible." };

  // Solve (attended + y) / (total + y) >= target/100 for y (classes to attend in a row)
  const need = Math.ceil((target * total - 100 * attended) / (100 - target));
  return {
    percent: percent,
    safe: false,
    message: "🚨 Attend the next " + need + " classes in a row to reach " + target + "%."
  };
}

function planRemaining(attended, total, target, remaining) {
  // "R classes are left this semester. How many must I attend?"
  if (!remaining || remaining < 1) return "Enter how many classes are left this semester.";
  const needed = Math.max(0, Math.ceil((target * (total + remaining)) / 100 - attended - 1e-9));
  if (needed > remaining) {
    return "❌ Even attending all " + remaining + " classes won't reach " + target + "%.";
  }
  return "Attend at least " + needed + " of the next " + remaining +
    " classes. You can skip up to " + (remaining - needed) + ".";
}

function planSkip(attended, total, skipN) {
  // "If I skip the next N classes, what will my percentage be?"
  if (!skipN || skipN < 1) return "Enter a number of classes to see the effect.";
  const projected = (attended / (total + skipN)) * 100;
  return "If you skip the next " + skipN + ", you'll drop to " + projected.toFixed(1) + "%.";
}

// ---------- Changing data ----------
function setStatus(id, date, status) {
  const sub = state.subjects.find(function (s) { return s.id === id; });
  if (!sub || !date) return;

  const i = sub.log.findIndex(function (e) { return e.date === date; });
  if (i >= 0 && sub.log[i].status === status) {
    sub.log.splice(i, 1);              // clicking the same button again = undo
  } else if (i >= 0) {
    sub.log[i].status = status;        // change an existing entry
  } else {
    sub.log.push({ date: date, status: status });   // new entry
  }
  save();
  renderAll();
}

function addSubject() {
  const name = $("nameInput").value.trim();
  const attended = Number($("attendedInput").value);
  const total = Number($("totalInput").value);
  const subTarget = Number($("subTargetInput").value);
  const error = $("error");

  if (name === "") { error.textContent = "Please enter a subject name."; return; }
  if ($("attendedInput").value === "" || $("totalInput").value === "") {
    error.textContent = "Please fill in both numbers (use 0 if you're starting fresh)."; return;
  }
  if (attended < 0 || total < 0 || attended > total) {
    error.textContent = "Attended can't be more than total (or negative)."; return;
  }
  if ($("subTargetInput").value !== "" && (subTarget < 1 || subTarget > 100)) {
    error.textContent = "Target must be between 1 and 100."; return;
  }

  error.textContent = "";
  state.subjects.push({
    id: Date.now(),                                  // unique id from the clock
    name: name,
    color: COLORS[state.subjects.length % COLORS.length],
    target: $("subTargetInput").value === "" ? null : subTarget,
    baseAttended: attended,
    baseTotal: total,
    remaining: 0,
    log: []
  });
  save();
  renderAll();

  $("nameInput").value = "";
  $("attendedInput").value = "";
  $("totalInput").value = "";
  $("subTargetInput").value = "";
}

function editSubject(sub) {
  const newName = prompt("Subject name:", sub.name);
  if (newName === null) return;                      // user pressed Cancel
  const newTarget = prompt("Own target % (leave empty to use the default):", sub.target || "");
  if (newTarget === null) return;

  if (newName.trim() !== "") sub.name = newName.trim();
  const t = Number(newTarget);
  sub.target = newTarget.trim() === "" || t < 1 || t > 100 ? null : t;
  save();
  renderAll();
}

function deleteSubject(sub) {
  if (!confirm("Delete " + sub.name + " and all its history?")) return;
  state.subjects = state.subjects.filter(function (s) { return s.id !== sub.id; });
  save();
  renderAll();
}

// ---------- Drawing: Dashboard ----------
function renderDashboard() {
  const list = $("subjectList");
  list.innerHTML = "";

  let totalAttended = 0;
  let totalClasses = 0;
  let risky = 0;

  state.subjects.forEach(function (sub) {
    const s = stats(sub);
    const target = targetOf(sub);
    const result = analyse(s.attended, s.total, target);

    totalAttended += s.attended;
    totalClasses += s.total;
    if (!result.safe) risky++;

    const card = el("div", result.safe ? "card" : "card danger");

    // top row: colored dot + name on the left, percentage on the right
    const top = el("div", "card-top");
    const nameWrap = el("div", "name-wrap");
    const dot = el("span", "dot");
    dot.style.background = sub.color;
    nameWrap.appendChild(dot);
    nameWrap.appendChild(el("span", "", sub.name));
    top.appendChild(nameWrap);
    top.appendChild(el("span", "percent", result.percent.toFixed(1) + "%"));

    const counts = el("p", "counts",
      s.attended + " / " + s.total + " classes  •  target " + target + "%  •  🔥 streak " + streak(sub));

    // progress bar with a black marker at the target position
    const bar = el("div", "bar");
    const fill = el("div", "bar-fill");
    fill.style.width = Math.min(result.percent, 100) + "%";
    const marker = el("div", "marker");
    marker.style.left = target + "%";
    bar.appendChild(fill);
    bar.appendChild(marker);

    const message = el("p", "message", result.message);

    // planner (these two inputs update only their own text, no full redraw)
    const planner = el("details", "planner");
    planner.appendChild(el("summary", "", "🧮 Planner"));

    const remIn = el("input");
    remIn.type = "number";
    remIn.min = 0;
    remIn.placeholder = "Classes left this semester";
    remIn.value = sub.remaining || "";
    const remOut = el("p", "plan-out", planRemaining(s.attended, s.total, target, sub.remaining));
    remIn.addEventListener("input", function () {
      sub.remaining = Number(remIn.value) || 0;
      save();
      remOut.textContent = planRemaining(s.attended, s.total, target, sub.remaining);
    });

    const skipIn = el("input");
    skipIn.type = "number";
    skipIn.min = 0;
    skipIn.placeholder = "What if I skip the next ... classes?";
    const skipOut = el("p", "plan-out", planSkip(s.attended, s.total, 0));
    skipIn.addEventListener("input", function () {
      skipOut.textContent = planSkip(s.attended, s.total, Number(skipIn.value));
    });

    planner.appendChild(remIn);
    planner.appendChild(remOut);
    planner.appendChild(skipIn);
    planner.appendChild(skipOut);

    const actions = el("div", "actions");
    const editBtn = el("button", "edit", "Edit");
    editBtn.addEventListener("click", function () { editSubject(sub); });
    const delBtn = el("button", "delete", "Delete");
    delBtn.addEventListener("click", function () { deleteSubject(sub); });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(top);
    card.appendChild(counts);
    card.appendChild(bar);
    card.appendChild(message);
    card.appendChild(planner);
    card.appendChild(actions);
    list.appendChild(card);
  });

  // overall summary box at the top
  const summary = $("summary");
  if (state.subjects.length === 0) {
    summary.textContent = "Add your first subject above 👆";
  } else {
    const overall = totalClasses === 0 ? 0 : (totalAttended / totalClasses) * 100;
    summary.textContent = "Overall: " + overall.toFixed(1) + "%  •  " +
      (risky > 0 ? risky + " subject(s) below target ⚠️" : "All subjects safe ✅");
  }
}

// ---------- Drawing: Mark tab ----------
function renderMark() {
  const date = $("dateInput").value;
  const box = $("markList");
  box.innerHTML = "";

  if (state.subjects.length === 0) {
    box.appendChild(el("p", "empty", "Add subjects in the Dashboard first."));
    return;
  }

  state.subjects.forEach(function (sub) {
    const row = el("div", "mark-row");
    row.appendChild(el("strong", "", sub.name));

    const found = sub.log.find(function (e) { return e.date === date; });
    const current = found ? found.status : null;

    const buttons = el("div", "mark-buttons");
    [["present", "✅ Present"], ["absent", "❌ Absent"], ["cancelled", "🚫 Cancelled"]]
      .forEach(function (pair) {
        const status = pair[0];
        const b = el("button", "status-btn " + status + (current === status ? " active" : ""), pair[1]);
        b.addEventListener("click", function () { setStatus(sub.id, date, status); });
        buttons.appendChild(b);
      });

    row.appendChild(buttons);
    box.appendChild(row);
  });
}

// ---------- Drawing: History tab ----------
function renderHistory() {
  const select = $("historyFilter");
  const keep = select.value;

  // rebuild the dropdown: "All subjects" + one option per subject
  select.innerHTML = "";
  const all = el("option", "", "All subjects");
  all.value = "all";
  select.appendChild(all);
  state.subjects.forEach(function (sub) {
    const o = el("option", "", sub.name);
    o.value = String(sub.id);
    select.appendChild(o);
  });
  select.value = keep || "all";
  if (!select.value) select.value = "all";   // the old choice was deleted

  // flatten every entry of every subject into one list
  const items = [];
  state.subjects.forEach(function (sub) {
    if (select.value !== "all" && String(sub.id) !== select.value) return;
    sub.log.forEach(function (entry) { items.push({ sub: sub, entry: entry }); });
  });
  items.sort(function (a, b) { return b.entry.date.localeCompare(a.entry.date); });   // newest first

  const box = $("historyList");
  box.innerHTML = "";
  if (items.length === 0) {
    box.appendChild(el("p", "empty", "No entries yet. Mark attendance in the Mark tab."));
    return;
  }

  const labels = { present: "✅ Present", absent: "❌ Absent", cancelled: "🚫 Cancelled" };
  items.forEach(function (item) {
    const row = el("div", "history-item");
    row.appendChild(el("span", "", item.entry.date + "  •  " + item.sub.name + "  •  " + labels[item.entry.status]));
    const del = el("button", "delete", "Undo");
    del.addEventListener("click", function () {
      item.sub.log = item.sub.log.filter(function (e) { return e !== item.entry; });
      save();
      renderAll();
    });
    row.appendChild(del);
    box.appendChild(row);
  });
}

function renderAll() {
  $("targetInput").value = state.target;
  renderDashboard();
  renderMark();
  renderHistory();
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    ["dashboard", "mark", "history"].forEach(function (name) {
      $("tab-" + name).classList.toggle("hidden", name !== btn.dataset.tab);
    });
  });
});

// ---------- Events ----------
$("addBtn").addEventListener("click", addSubject);

$("targetInput").addEventListener("change", function () {
  const t = Number($("targetInput").value);
  state.target = t >= 1 && t <= 100 ? t : 75;
  save();
  renderAll();
});

$("dateInput").addEventListener("change", renderMark);
$("historyFilter").addEventListener("change", renderHistory);

$("themeBtn").addEventListener("click", function () {
  const dark = document.body.classList.toggle("dark");
  localStorage.setItem("attendanceDark", dark ? "1" : "0");
  $("themeBtn").textContent = dark ? "☀️" : "🌙";
});

// backup: download the data as a file
$("exportBtn").addEventListener("click", function () {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "attendance-backup.json";
  a.click();
  URL.revokeObjectURL(url);
});

// backup: load a file back in
$("importFile").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.subjects)) throw new Error("bad file");
      data.subjects.forEach(function (s) { s.log = s.log || []; });
      state = { target: Number(data.target) || 75, subjects: data.subjects };
      save();
      renderAll();
      alert("Backup loaded ✅");
    } catch (err) {
      alert("That file isn't a valid backup.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";   // lets you import the same file again later
});

// ---------- Start ----------
$("dateInput").value = todayStr();
if (localStorage.getItem("attendanceDark") === "1") {
  document.body.classList.add("dark");
  $("themeBtn").textContent = "☀️";
}
renderAll();