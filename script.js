const TOTAL_MINUTES = 1440;
const SNAP_STEP = 15; // 15-minute magnetic snap
const LABELED_HOURS = [3, 6, 9, 12, 15, 18, 21];

function toISO(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeToMinutes(str) {
  if (str === "24:00") return 1440;
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTimeStr(min) {
  min = Math.max(0, Math.min(1440, min));
  if (min === 1440) return "24:00";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function snapMinutes(mins) {
  return Math.max(0, Math.min(1440, Math.round(mins / SNAP_STEP) * SNAP_STEP));
}

function pct(minutes) {
  return (minutes / TOTAL_MINUTES) * 100;
}

function getContrastYIQ(hex) {
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const r = parseInt(c.substr(0, 2), 16) || 0;
  const g = parseInt(c.substr(2, 2), 16) || 0;
  const b = parseInt(c.substr(4, 2), 16) || 0;
  return (((r * 299) + (g * 587) + (b * 114)) / 1000 >= 135) ? '#0b0f19' : '#ffffff';
}

// App State
let currentDate = new Date();
let currentView = "day";
let metricsExpanded = true;

const defaultEvents = [
  {
    id: "evt-1",
    title: "Core Architecture Sprint",
    desc: "Profiling memory hotspots and latency overhead.",
    date: toISO(new Date()),
    start: "08:30",
    end: "11:30",
    color: "#4f46e5"
  },
  {
    id: "evt-2",
    title: "Network Diagnostics",
    desc: "Packet triage and firewall verification.",
    date: toISO(new Date()),
    start: "11:00",
    end: "13:00",
    color: "#0284c7"
  },
  {
    id: "evt-3",
    title: "Refactor Cleanroom",
    desc: "Modular refactor and test suites.",
    date: toISO(new Date()),
    start: "14:30",
    end: "17:00",
    color: "#059669"
  }
];

let events = JSON.parse(localStorage.getItem("timeline_events_v8")) || defaultEvents;

// Guidelines Initialization
function createGuidelinesFragment(halfTicks = true) {
  const frag = document.createDocumentFragment();
  for (let h = 0; h <= 24; h++) {
    const leftPct = pct(h * 60);
    if (h < 24) {
      const line = document.createElement("div");
      line.className = "line-hour";
      line.style.left = `${leftPct}%`;
      frag.appendChild(line);

      if (halfTicks) {
        const subLine = document.createElement("div");
        subLine.className = "line-half";
        subLine.style.left = `${pct(h * 60 + 30)}%`;
        frag.appendChild(subLine);
      }
    }
  }
  return frag;
}

function createRulerLabelsFragment() {
  const frag = document.createDocumentFragment();
  for (let h = 0; h <= 24; h++) {
    if (LABELED_HOURS.includes(h)) {
      const label = document.createElement("div");
      label.className = "label-hour";
      label.style.left = `${pct(h * 60)}%`;
      label.textContent = `${h.toString().padStart(2, "0")}:00`;
      frag.appendChild(label);
    }
  }
  return frag;
}

function initGuidelines() {
  document.getElementById("guidelinesLayer").appendChild(createGuidelinesFragment(true));
  document.getElementById("rulerLabels").appendChild(createRulerLabelsFragment());
  document.getElementById("weekRulerLabels").appendChild(createRulerLabelsFragment());
}

function scrollToNowIfToday() {
  const todayIso = toISO(new Date());
  if (toISO(currentDate) === todayIso) {
    const container = document.getElementById("dayScrollContainer");
    const nowLine = document.getElementById("nowLine");
    if (container && nowLine) {
      const targetX = nowLine.offsetLeft - (container.clientWidth / 2);
      container.scrollTo({ left: Math.max(0, targetX), behavior: "smooth" });
    }
  }
}

// Master Render
function render() {
  updateHeaderTitle();

  if (currentView === "day") {
    renderDayView();
    renderTimeBudget();
  } else if (currentView === "week") {
    renderWeekView();
  } else if (currentView === "month") {
    renderMonthView();
  }

  renderFeed();
  localStorage.setItem("timeline_events_v8", JSON.stringify(events));
}

function updateHeaderTitle() {
  const heading = document.getElementById("currentDateHeading");
  const optionsMonth = { month: "short", year: "numeric" };
  const optionsFull = { weekday: "short", month: "short", day: "numeric" };

  if (currentView === "month") {
    heading.textContent = currentDate.toLocaleDateString(undefined, optionsMonth);
  } else if (currentView === "week") {
    const startOfWeek = getStartOfWeek(currentDate);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    heading.textContent = `${startOfWeek.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${endOfWeek.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  } else {
    heading.textContent = currentDate.toLocaleDateString(undefined, optionsFull);
  }
  document.getElementById("feedTitle").textContent = `Events: ${toISO(currentDate)}`;
}

// 1. DAY VIEW RENDERING & BUFFER GENERATION
function renderDayView() {
  const track = document.getElementById("track");
  const bufferLayer = document.getElementById("bufferLayer");
  
  track.querySelectorAll(".event-block").forEach(e => e.remove());
  bufferLayer.innerHTML = "";

  const dayIso = toISO(currentDate);
  const dayEvents = events.filter(e => e.date === dayIso);

  dayEvents.sort((a, b) => {
    const diff = timeToMinutes(a.start) - timeToMinutes(b.start);
    if (diff !== 0) return diff;
    return (timeToMinutes(b.end) - timeToMinutes(b.start)) - (timeToMinutes(a.end) - timeToMinutes(a.start));
  });

  const laneEndTimes = [];
  const processedEvents = dayEvents.map(ev => {
    const s = timeToMinutes(ev.start);
    const e = timeToMinutes(ev.end);
    let assignedLane = -1;

    for (let l = 0; l < laneEndTimes.length; l++) {
      if (laneEndTimes[l] <= s) {
        assignedLane = l;
        laneEndTimes[l] = e;
        break;
      }
    }
    if (assignedLane === -1) {
      assignedLane = laneEndTimes.length;
      laneEndTimes.push(e);
    }
    return { ...ev, sMin: s, eMin: e, lane: assignedLane };
  });

  processedEvents.forEach((ev, idx) => {
    ev.hasConflict = processedEvents.some((other, oIdx) => {
      if (idx === oIdx) return false;
      return (ev.sMin < other.eMin && ev.eMin > other.sMin);
    });
  });

  const totalLanes = Math.max(1, laneEndTimes.length);

  processedEvents.forEach(ev => {
    const left = pct(ev.sMin);
    const width = Math.max(0.75, pct(ev.eMin) - left);

    const block = document.createElement("div");
    block.className = `event-block ${ev.hasConflict ? "has-conflict" : ""}`;
    block.dataset.id = ev.id;
    block.style.left = `${left}%`;
    block.style.width = `${width}%`;
    block.style.backgroundColor = ev.color;
    block.style.color = getContrastYIQ(ev.color);

    if (totalLanes > 1) {
      const topOffset = 4 + ev.lane * 30;
      block.style.top = `${topOffset}px`;
      block.style.height = `28px`;
    } else {
      block.style.top = `6px`;
      block.style.bottom = `6px`;
    }

    block.innerHTML = `
      <div class="resize-handle handle-left" data-side="left" title="Drag to adjust start"></div>
      <strong>${ev.hasConflict ? '⚠️ ' : ''}${ev.title}</strong>
      <span>${ev.start} - ${ev.end}</span>
      <div class="resize-handle handle-right" data-side="right" title="Drag to adjust end"></div>
    `;

    block.addEventListener("click", (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      showInspectModal(ev);
    });

    track.appendChild(block);
  });

  renderBufferGaps(processedEvents, bufferLayer);

  track.style.height = totalLanes > 1 ? `${Math.max(68, totalLanes * 32 + 8)}px` : `68px`;

  const nowLine = document.getElementById("nowLine");
  nowLine.style.display = (dayIso === toISO(new Date())) ? "block" : "none";
}

function renderBufferGaps(dayEvents, container) {
  if (!dayEvents.length) {
    appendBufferBlock(0, 1440, container);
    return;
  }

  const busySpans = [];
  dayEvents.forEach(ev => {
    if (!busySpans.length) {
      busySpans.push([ev.sMin, ev.eMin]);
    } else {
      const prev = busySpans[busySpans.length - 1];
      if (ev.sMin <= prev[1]) {
        prev[1] = Math.max(prev[1], ev.eMin);
      } else {
        busySpans.push([ev.sMin, ev.eMin]);
      }
    }
  });

  let cursor = 0;
  busySpans.forEach(([s, e]) => {
    if (s > cursor) {
      appendBufferBlock(cursor, s, container);
    }
    cursor = Math.max(cursor, e);
  });
  if (cursor < 1440) {
    appendBufferBlock(cursor, 1440, container);
  }
}

function appendBufferBlock(startMin, endMin, container) {
  const dur = endMin - startMin;
  if (dur < 15) return;

  const left = pct(startMin);
  const width = pct(endMin) - left;

  const block = document.createElement("div");
  block.className = "buffer-block";
  block.style.left = `${left}%`;
  block.style.width = `${width}%`;

  const hrs = Math.floor(dur / 60);
  const mins = dur % 60;
  const durStr = hrs > 0 ? (mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`) : `${mins}m`;

  if (dur >= 30) {
    block.innerHTML = `<span class="buffer-label">${durStr} open</span>`;
  }

  container.appendChild(block);
}

// 2. TIME BUDGETING METRICS
function renderTimeBudget() {
  const dayIso = toISO(currentDate);
  const dayEvents = events.filter(e => e.date === dayIso);

  let totalScheduledMins = 0;
  const categoryTotals = {};

  dayEvents.forEach(ev => {
    const dur = Math.max(0, timeToMinutes(ev.end) - timeToMinutes(ev.start));
    totalScheduledMins += dur;
    categoryTotals[ev.color] = (categoryTotals[ev.color] || 0) + dur;
  });

  const unallocatedMins = Math.max(0, TOTAL_MINUTES - totalScheduledMins);
  const scheduledHours = (totalScheduledMins / 60).toFixed(1);
  const unallocatedHours = (unallocatedMins / 60).toFixed(1);

  document.getElementById("metricsTotalReadout").textContent = `${scheduledHours}h Planned / ${unallocatedHours}h Free`;

  const barTrack = document.getElementById("metricsBarTrack");
  barTrack.innerHTML = "";

  Object.entries(categoryTotals).forEach(([color, mins]) => {
    const seg = document.createElement("div");
    seg.className = "metrics-bar-segment";
    seg.style.width = `${(mins / TOTAL_MINUTES) * 100}%`;
    seg.style.backgroundColor = color;
    barTrack.appendChild(seg);
  });

  if (unallocatedMins > 0) {
    const freeSeg = document.createElement("div");
    freeSeg.className = "metrics-bar-segment";
    freeSeg.style.width = `${(unallocatedMins / TOTAL_MINUTES) * 100}%`;
    freeSeg.style.backgroundColor = "#1f2937";
    barTrack.appendChild(freeSeg);
  }

  const chipsContainer = document.getElementById("metricsChips");
  chipsContainer.innerHTML = "";

  Object.entries(categoryTotals).forEach(([color, mins]) => {
    const chip = document.createElement("div");
    chip.className = "metric-chip";
    chip.innerHTML = `
      <div class="metric-dot" style="background-color: ${color};"></div>
      <span>${(mins / 60).toFixed(1)}h</span>
    `;
    chipsContainer.appendChild(chip);
  });

  const freeChip = document.createElement("div");
  freeChip.className = "metric-chip";
  freeChip.innerHTML = `
    <div class="metric-dot" style="background-color: #4b5563;"></div>
    <span style="color: var(--text-muted);">${unallocatedHours}h Unallocated</span>
  `;
  chipsContainer.appendChild(freeChip);
}

document.getElementById("metricsToggle").addEventListener("click", () => {
  metricsExpanded = !metricsExpanded;
  document.getElementById("metricsBarTrack").style.display = metricsExpanded ? "flex" : "none";
  document.getElementById("metricsChips").style.display = metricsExpanded ? "flex" : "none";
  document.getElementById("metricsToggleIcon").textContent = metricsExpanded ? "▼" : "▲";
});

// 3. DAW-STYLE DRAG CREATION & RESIZING (Track = Draw, Ruler = Scroll)
const trackElement = document.getElementById("track");
const dragGhost = document.getElementById("dragGhost");
const scrollContainer = document.getElementById("dayScrollContainer");

let dragMode = null; // 'create' | 'resize'
let dragStartX = 0;
let dragStartMin = 0;
let activeResizeEvent = null;
let activeResizeSide = null;
let activeBlockElement = null;
let tempResizeStart = null;
let tempResizeEnd = null;

function xToMinutes(clientX) {
  const rect = trackElement.getBoundingClientRect();
  const offsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
  return (offsetX / rect.width) * TOTAL_MINUTES;
}

// Pointer Down
trackElement.addEventListener("pointerdown", (e) => {
  // 1. Handle Resize
  if (e.target.classList.contains("resize-handle")) {
    e.stopPropagation();
    e.preventDefault();
    dragMode = "resize";
    activeResizeSide = e.target.dataset.side;
    activeBlockElement = e.target.closest(".event-block");
    activeResizeEvent = events.find(ev => ev.id === activeBlockElement.dataset.id);
    tempResizeStart = timeToMinutes(activeResizeEvent.start);
    tempResizeEnd = timeToMinutes(activeResizeEvent.end);
    trackElement.setPointerCapture(e.pointerId);
    return;
  }

  // 2. Ignore clicks on existing event bodies (let them open the modal)
  if (e.target.closest(".event-block")) {
    return;
  }

  // 3. Immediately start drawing block on track drag/touch
  dragMode = "create";
  dragStartX = e.clientX;
  dragStartMin = snapMinutes(xToMinutes(e.clientX));

  dragGhost.style.display = "flex";
  dragGhost.style.left = `${pct(dragStartMin)}%`;
  dragGhost.style.width = `0%`;
  dragGhost.textContent = minutesToTimeStr(dragStartMin);

  trackElement.setPointerCapture(e.pointerId);
});

// Pointer Move
trackElement.addEventListener("pointermove", (e) => {
  if (!dragMode) return;

  // Auto-scroll when dragging near screen edges
  const containerRect = scrollContainer.getBoundingClientRect();
  if (e.clientX < containerRect.left + 50) {
    scrollContainer.scrollLeft -= 16;
  } else if (e.clientX > containerRect.right - 50) {
    scrollContainer.scrollLeft += 16;
  }

  const currentMins = snapMinutes(xToMinutes(e.clientX));

  if (dragMode === "create") {
    const s = Math.min(dragStartMin, currentMins);
    const eMin = Math.max(dragStartMin, currentMins);
    const left = pct(s);
    const width = pct(eMin) - left;

    dragGhost.style.left = `${left}%`;
    dragGhost.style.width = `${Math.max(1, width)}%`;
    dragGhost.textContent = `${minutesToTimeStr(s)} - ${minutesToTimeStr(eMin)}`;
  } else if (dragMode === "resize" && activeResizeEvent && activeBlockElement) {
    if (activeResizeSide === "left") {
      if (currentMins < tempResizeEnd) tempResizeStart = currentMins;
    } else if (activeResizeSide === "right") {
      if (currentMins > tempResizeStart) tempResizeEnd = currentMins;
    }

    const leftPct = pct(tempResizeStart);
    const widthPct = pct(tempResizeEnd) - leftPct;
    activeBlockElement.style.left = `${leftPct}%`;
    activeBlockElement.style.width = `${Math.max(0.75, widthPct)}%`;
    
    const label = activeBlockElement.querySelector("span");
    if (label) {
      label.textContent = `${minutesToTimeStr(tempResizeStart)} - ${minutesToTimeStr(tempResizeEnd)}`;
    }
  }
});

// Pointer Up
trackElement.addEventListener("pointerup", (e) => {
  if (!dragMode) return;

  if (dragMode === "create") {
    const dragEndMin = snapMinutes(xToMinutes(e.clientX));
    const s = Math.min(dragStartMin, dragEndMin);
    let eMin = Math.max(dragStartMin, dragEndMin);

    dragGhost.style.display = "none";

    // If user tapped without dragging, allocate standard 1-hour block
    if (eMin - s < 15) {
      eMin = Math.min(1440, s + 60);
    }

    openCreateModalWithRange(s, eMin);
  } else if (dragMode === "resize" && activeResizeEvent) {
    if (tempResizeStart !== null && tempResizeEnd !== null) {
      activeResizeEvent.start = minutesToTimeStr(tempResizeStart);
      activeResizeEvent.end = minutesToTimeStr(tempResizeEnd);
    }
    render();
  }

  try { trackElement.releasePointerCapture(e.pointerId); } catch(err) {}
  dragMode = null;
  activeResizeEvent = null;
  activeResizeSide = null;
  activeBlockElement = null;
  tempResizeStart = null;
  tempResizeEnd = null;
});

trackElement.addEventListener("pointercancel", (e) => {
  dragGhost.style.display = "none";
  dragMode = null;
  activeResizeEvent = null;
  activeResizeSide = null;
  activeBlockElement = null;
  try { trackElement.releasePointerCapture(e.pointerId); } catch(err) {}
});

function openCreateModalWithRange(sMin, eMin) {
  const iso = toISO(currentDate);
  document.getElementById("evStartDate").value = iso;
  document.getElementById("evEndDate").value = iso;
  document.getElementById("evStartTime").value = minutesToTimeStr(sMin);
  document.getElementById("evEndTime").value = minutesToTimeStr(eMin);
  createModal.classList.add("open");
  setTimeout(() => document.getElementById("evTitle").focus(), 80);
}

// 4. WEEK & MONTH VIEWS
function getStartOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function renderWeekView() {
  const container = document.getElementById("weekRowsContainer");
  container.innerHTML = "";

  const start = getStartOfWeek(currentDate);
  const todayIso = toISO(new Date());

  for (let i = 0; i < 7; i++) {
    const loopDay = new Date(start);
    loopDay.setDate(start.getDate() + i);
    const loopIso = toISO(loopDay);

    const row = document.createElement("div");
    row.className = "week-row";

    const label = document.createElement("div");
    label.className = `week-label ${loopIso === todayIso ? "is-today" : ""}`;
    label.innerHTML = `<strong>${loopDay.toLocaleDateString(undefined, { weekday: "short" })}</strong> ${loopDay.getDate()}`;
    label.addEventListener("click", () => {
      currentDate = new Date(loopDay);
      switchView("day");
    });

    const track = document.createElement("div");
    track.className = "week-track";
    track.appendChild(createGuidelinesFragment(false));

    const dayEvs = events.filter(e => e.date === loopIso);
    dayEvs.forEach(ev => {
      const sMin = timeToMinutes(ev.start);
      const eMin = timeToMinutes(ev.end);
      const left = pct(sMin);
      const width = Math.max(0.75, pct(eMin) - left);

      const block = document.createElement("div");
      block.className = "event-block";
      block.style.left = `${left}%`;
      block.style.width = `${width}%`;
      block.style.backgroundColor = ev.color;
      block.style.color = getContrastYIQ(ev.color);
      block.style.padding = "2px 6px";
      block.innerHTML = `<strong>${ev.title}</strong>`;
      block.addEventListener("click", (e) => {
        e.stopPropagation();
        showInspectModal(ev);
      });
      track.appendChild(block);
    });

    track.addEventListener("click", () => {
      currentDate = new Date(loopDay);
      switchView("day");
    });

    row.appendChild(label);
    row.appendChild(track);
    container.appendChild(row);
  }
}

function renderMonthView() {
  const grid = document.getElementById("monthGrid");
  grid.innerHTML = "";

  const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  daysOfWeek.forEach(d => {
    const header = document.createElement("div");
    header.className = "month-header-cell";
    header.textContent = d;
    grid.appendChild(header);
  });

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const todayIso = toISO(new Date());
  const selectedIso = toISO(currentDate);

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const cell = document.createElement("div");
    cell.className = "month-day-cell other-month";
    cell.innerHTML = `<span class="day-number">${prevMonthDays - i}</span>`;
    grid.appendChild(cell);
  }

  for (let d = 1; d <= totalDays; d++) {
    const thisDate = new Date(year, month, d);
    const iso = toISO(thisDate);

    const cell = document.createElement("div");
    cell.className = `month-day-cell ${iso === todayIso ? "is-today" : ""} ${iso === selectedIso ? "is-selected" : ""}`;
    cell.innerHTML = `<span class="day-number">${d}</span>`;

    const dayEvs = events.filter(e => e.date === iso);
    dayEvs.slice(0, 3).forEach(ev => {
      const chip = document.createElement("div");
      chip.className = "day-event-chip";
      chip.style.backgroundColor = ev.color;
      chip.style.color = getContrastYIQ(ev.color);
      chip.textContent = ev.title;
      cell.appendChild(chip);
    });
    if (dayEvs.length > 3) {
      const more = document.createElement("div");
      more.style.fontSize = "0.55rem";
      more.style.color = "var(--text-muted)";
      more.textContent = `+${dayEvs.length - 3}`;
      cell.appendChild(more);
    }

    cell.addEventListener("click", () => {
      currentDate = thisDate;
      switchView("day");
    });

    grid.appendChild(cell);
  }
}

// 5. FEED RENDER & CONFLICT BADGING
function renderFeed() {
  const feed = document.getElementById("eventFeed");
  feed.innerHTML = "";

  const dayIso = toISO(currentDate);
  const dayEvents = events
    .filter(e => e.date === dayIso)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  if (dayEvents.length === 0) {
    feed.innerHTML = `<div style="font-size: 0.72rem; color: var(--text-muted); padding: 6px 0;">No events for this day. Click and drag across the timeline or tap "+ New Event" to schedule.</div>`;
    return;
  }

  dayEvents.forEach(ev => {
    const s = timeToMinutes(ev.start);
    const e = timeToMinutes(ev.end);
    const hasConflict = dayEvents.some(other => other.id !== ev.id && (s < timeToMinutes(other.end) && e > timeToMinutes(other.start)));

    const item = document.createElement("div");
    item.className = `event-card ${hasConflict ? 'conflict-alert' : ''}`;
    item.style.borderLeftColor = ev.color;
    item.innerHTML = `
      <div style="flex: 1; min-width: 0; margin-right: 8px;">
        <strong>
          ${hasConflict ? '<span style="color: var(--conflict); font-size: 0.75rem;">⚠️ [Double Booked]</span> ' : ''}
          ${ev.title} ${ev.partInfo ? `<span style="color: var(--accent); font-size: 0.68rem;">(${ev.partInfo})</span>` : ""}
        </strong>
        <div class="time-range">${ev.start} – ${ev.end}</div>
        ${ev.desc ? `<div class="desc">${ev.desc}</div>` : ""}
      </div>
      <button class="btn-delete" title="Delete Event" onclick="deleteEvent('${ev.id}')">&times;</button>
    `;
    feed.appendChild(item);
  });
}

// 6. REAL-TIME PLAYHEAD
function tick() {
  const now = new Date();
  document.getElementById("clockDisplay").textContent = now.toTimeString().split(" ")[0];

  const currentMins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const nowLine = document.getElementById("nowLine");
  nowLine.style.left = `${pct(currentMins)}%`;

  const todayIso = toISO(now);
  const active = events.find(ev => {
    if (ev.date !== todayIso) return false;
    const s = timeToMinutes(ev.start);
    const e = timeToMinutes(ev.end);
    return currentMins >= s && currentMins < e;
  });

  const activeLabel = document.getElementById("activeTaskLabel");
  if (active) {
    activeLabel.textContent = `${active.title} (until ${active.end})`;
    activeLabel.style.color = active.color;
  } else {
    activeLabel.textContent = "Unscheduled / Buffer";
    activeLabel.style.color = "var(--text-muted)";
  }
}

// 7. NAVIGATION & CONTROLS
function switchView(view) {
  currentView = view;
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  document.getElementById("dayView").style.display = (view === "day") ? "block" : "none";
  document.getElementById("weekView").style.display = (view === "week") ? "block" : "none";
  document.getElementById("monthView").style.display = (view === "month") ? "block" : "none";

  render();
  if (view === "day") scrollToNowIfToday();
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("btnPrev").addEventListener("click", () => {
  if (currentView === "month") {
    currentDate.setMonth(currentDate.getMonth() - 1);
  } else if (currentView === "week") {
    currentDate.setDate(currentDate.getDate() - 7);
  } else {
    currentDate.setDate(currentDate.getDate() - 1);
  }
  render();
});

document.getElementById("btnNext").addEventListener("click", () => {
  if (currentView === "month") {
    currentDate.setMonth(currentDate.getMonth() + 1);
  } else if (currentView === "week") {
    currentDate.setDate(currentDate.getDate() + 7);
  } else {
    currentDate.setDate(currentDate.getDate() + 1);
  }
  render();
});

document.getElementById("btnToday").addEventListener("click", () => {
  currentDate = new Date();
  render();
  scrollToNowIfToday();
});

const hexInput = document.getElementById("evHex");
const nativePicker = document.getElementById("nativePicker");
const colorPreview = document.getElementById("colorPreview");

function updateColorState(val) {
  colorPreview.style.backgroundColor = val;
  nativePicker.value = val;
}

nativePicker.addEventListener("input", (e) => {
  const val = e.target.value.toUpperCase();
  hexInput.value = val;
  colorPreview.style.backgroundColor = val;
});

hexInput.addEventListener("input", (e) => {
  let val = e.target.value.trim();
  if (!val.startsWith("#")) val = "#" + val;
  if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
    updateColorState(val);
  }
});

document.getElementById("evStartDate").addEventListener("change", (e) => {
  const startVal = e.target.value;
  const endInput = document.getElementById("evEndDate");
  if (!endInput.value || endInput.value < startVal) {
    endInput.value = startVal;
  }
});

// Modal Controls
const createModal = document.getElementById("createModalOverlay");
function openCreateModal() {
  const iso = toISO(currentDate);
  document.getElementById("evStartDate").value = iso;
  document.getElementById("evEndDate").value = iso;
  createModal.classList.add("open");
}
function closeCreateModal() {
  createModal.classList.remove("open");
}

document.getElementById("btnOpenCreateModal").addEventListener("click", openCreateModal);
document.getElementById("btnCloseCreateModal").addEventListener("click", closeCreateModal);
document.getElementById("btnCancelCreate").addEventListener("click", closeCreateModal);
createModal.addEventListener("click", (e) => {
  if (e.target === createModal) closeCreateModal();
});

document.getElementById("addBtn").addEventListener("click", () => {
  const title = document.getElementById("evTitle").value.trim();
  const desc = document.getElementById("evDesc").value.trim();
  const startDate = document.getElementById("evStartDate").value;
  const startTime = document.getElementById("evStartTime").value;
  const endDate = document.getElementById("evEndDate").value;
  const endTime = document.getElementById("evEndTime").value;

  let color = hexInput.value.trim();
  if (!color.startsWith("#")) color = "#" + color;
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) color = "#38BDF8";

  if (!title) {
    alert("Please provide an event title.");
    return;
  }
  if (!startDate || !endDate) {
    alert("Please specify both Start Date and End Date.");
    return;
  }

  const startTimestamp = new Date(`${startDate}T${startTime}`).getTime();
  const endTimestamp = new Date(`${endDate}T${endTime}`).getTime();

  if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
    alert("Invalid date or time entered.");
    return;
  }
  if (endTimestamp <= startTimestamp) {
    alert("End time must be after the start time.");
    return;
  }

  const fullRangeStr = `${startDate} ${startTime} → ${endDate} ${endTime}`;
  const sharedGroupId = "grp-" + Date.now();

  let curDay = new Date(`${startDate}T00:00:00`);
  const lastDay = new Date(`${endDate}T00:00:00`);

  const slices = [];
  while (curDay <= lastDay) {
    const curIso = toISO(curDay);
    let s = "00:00";
    let e = "24:00";

    if (curIso === startDate && curIso === endDate) {
      s = startTime;
      e = endTime;
    } else if (curIso === startDate) {
      s = startTime;
      e = "24:00";
    } else if (curIso === endDate) {
      if (endTime === "00:00") break;
      s = "00:00";
      e = endTime;
    } else {
      s = "00:00";
      e = "24:00";
    }

    slices.push({ date: curIso, start: s, end: e });
    curDay.setDate(curDay.getDate() + 1);
  }

  const totalParts = slices.length;
  slices.forEach((slice, idx) => {
    events.push({
      id: `evt-${Date.now()}-${idx + 1}`,
      groupId: totalParts > 1 ? sharedGroupId : null,
      title,
      partInfo: totalParts > 1 ? `Part ${idx + 1}/${totalParts}` : null,
      desc,
      date: slice.date,
      start: slice.start,
      end: slice.end,
      originalRange: fullRangeStr,
      color
    });
  });

  document.getElementById("evTitle").value = "";
  document.getElementById("evDesc").value = "";

  closeCreateModal();
  render();
});

const inspectModal = document.getElementById("inspectModalOverlay");
function showInspectModal(ev) {
  document.getElementById("mTitle").textContent = ev.title;
  document.getElementById("mTime").textContent = ev.originalRange 
    ? `Full Span: ${ev.originalRange}` 
    : `${ev.date} | ${ev.start} - ${ev.end}`;
  document.getElementById("mDesc").textContent = ev.desc || "No description provided.";
  inspectModal.classList.add("open");
}
document.getElementById("mClose").addEventListener("click", () => inspectModal.classList.remove("open"));
inspectModal.addEventListener("click", (e) => {
  if (e.target === inspectModal) inspectModal.classList.remove("open");
});

window.deleteEvent = function(id) {
  const target = events.find(e => e.id === id);
  if (!target) return;

  if (target.groupId) {
    events = events.filter(e => e.groupId !== target.groupId);
  } else {
    events = events.filter(e => e.id !== id);
  }
  render();
};

// Bootstrap
initGuidelines();
render();
setInterval(tick, 1000);
tick();

setTimeout(scrollToNowIfToday, 300);
