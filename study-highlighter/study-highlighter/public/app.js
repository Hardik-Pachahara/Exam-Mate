const element = id => document.getElementById(id);
const drop = element('drop')
const file = element('file')
const status = element('status')
const picker = element('picker');
let cats = {}
let pdf = null
let total = 0;

fetch('/api/categories').then(response => response.json()).then(c => {
  cats = c;
  element('legend').innerHTML = Object.values(c).map(x => `<li style="background:${x.color}">${x.label}</li>`).join('');
});

drop.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && file.click());
// 3D tilt + spotlight that follow the cursor over the drop box
drop.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const r = drop.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;    // 0 to 1
  const y = (e.clientY - r.top) / r.height;
  drop.classList.add('tracking');
  drop.style.setProperty('--mx', `${x * 100}%`);
  drop.style.setProperty('--my', `${y * 100}%`);
  drop.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);   // up to 6 degrees left/right
  drop.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);   // up to 5 degrees up/down
});
drop.addEventListener('pointerleave', () => {
  drop.classList.remove('tracking');
  ['--rx', '--ry'].forEach(p => drop.style.setProperty(p, '0deg'));
  drop.style.setProperty('--mx', '50%'); drop.style.setProperty('--my', '50%');
});
['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', e => { e.preventDefault(); choose(e.dataTransfer.files[0]); });
file.addEventListener('change', () => choose(file.files[0]));
element('change').addEventListener('click', reset);
element('again').addEventListener('click', reset);
window.addEventListener('keydown', highlight_by_enter);
element('go').addEventListener('click', highlight_by_click);

function reset() {
  pdf = null; total = 0;
  element('result').hidden = true;
  element('upload').hidden = false;
  element('options').hidden = true;
  drop.hidden = false;
  element('topic').value = '';
  show('');
}

// Step 1: pick a PDF, ask the server how many pages it has, then show the options.
async function choose(f) {
  file.value = ''; // lets you pick the same file again after an error
  if (!f || f.type !== 'application/pdf') return show('Choose a PDF file.', true);
  show('Reading the PDF...');
  const body = new FormData(); body.append('pdf', f);
  const data = await post('/api/pages', body);
  if (!data) return;
  pdf = f; total = data.pageCount;
  element('fileName').textContent = f.name;
  element('pageCount').textContent = `${total} page${total === 1 ? '' : 's'}`;
  buildPicker();
  drop.hidden = true;
  element('options').hidden = false;
  show('');
}

// Rotating messages shown by the animated loader while the server works.
const loaderMessages = ['Reading your pages', 'Finding the key points', 'Marking them up', 'Almost there'];
let loaderTimer = null;
function setLoading(on) {
  element('loader').hidden = !on;
  element('options').classList.toggle('busy', on);
  clearInterval(loaderTimer);
  if (!on) return;
  let n = 0;
  element('loaderText').textContent = loaderMessages[0];
  loaderTimer = setInterval(() => {
    n = Math.min(n + 1, loaderMessages.length - 1);
    element('loaderText').textContent = loaderMessages[n];
  }, 4000);
}

// Both functions send the same request; this part is shared.
async function sendHighlight() {
  const sel = selected();
  if (!pdf || !sel.length || element('go').disabled) return;
  const topic = element('topic').value.trim();
  const body = new FormData();
  body.append('pdf', pdf);
  if (sel.length < total) body.append('pages', sel.join(',')); // leave out = all pages
  body.append('topic', topic);
  element('go').disabled = true;
  setLoading(true);
  show('Reading pages and marking key points. Long chapters can take a few minutes.');
  const data = await post('/api/highlight', body);
  setLoading(false);
  element('go').disabled = !selected().length;
  if (data) render(data);
}

// Step 2: pressing Enter starts the highlighting.
async function highlight_by_enter(event) {
  if (event.key !== 'Enter') return;
  // Enter on a focused button/link/summary already "clicks" it, so don't run twice; ignore typing in other forms.
  if (event.target.closest && event.target.closest('button, a, summary, #auth')) return;
  await sendHighlight();
}

// Step 2: clicking the Highlight button does the same.
async function highlight_by_click() {
  await sendHighlight();
}

async function post(url, body) {
  let res;
  try { res = await fetch(url, { method: 'POST', body }); }
  catch { show('Cannot reach the app server. Is it still running in the terminal?', true); return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { show(data.error || 'Something went wrong on the server. Check the terminal.', true); return null; }
  return data;
}

// ---- page dropdown ----
function buildPicker() {
  element('pageList').innerHTML =
    `<label class="chk all"><input type="checkbox" id="selAll" checked> Select all</label>` +
    Array.from({ length: total }, (_, i) =>
      `<label class="chk"><input type="checkbox" name="pg" value="${i + 1}" checked> Page ${i + 1}</label>`).join('');
  picker.open = false;
  updatePicker();
}
const boxes = () => [...document.querySelectorAll('#pageList input[name=pg]')];
const selected = () => boxes().filter(b => b.checked).map(b => +b.value);

element('pageList').addEventListener('change', e => {
  if (e.target.id === 'selAll') boxes().forEach(b => (b.checked = e.target.checked));
  updatePicker();
});
document.addEventListener('click', e => { if (picker.open && !picker.contains(e.target)) picker.open = false; });
picker.addEventListener('keydown', e => { if (e.key === 'Escape') { picker.open = false; picker.querySelector('summary').focus(); } });

function ranges(nums) {            // [1,2,3,5] -> "1-3, 5"
  const out = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}\u2013${nums[j]}` : `${nums[i]}`);
    i = j + 1;
  }
  return out.join(', ');
}

function updatePicker() {
  const sel = selected()
  let all = element('selAll');
  all.checked = sel.length === total;
  all.indeterminate = sel.length > 0 && sel.length < total;
  const list = ranges(sel);
  element('pickerSummary').textContent =
    !sel.length ? 'No pages selected'
      : sel.length === total ? `All ${total} page${total === 1 ? '' : 's'}`
        : list.length <= 36 ? `Page${sel.length === 1 ? '' : 's'} ${list}`
          : `${sel.length} pages selected`;
  element('go').disabled = !sel.length;
}

function show(msg, err) { status.textContent = msg; status.className = err ? 'error' : ''; status.setAttribute('role', err ? 'alert' : 'status'); }

function render({ pdfUrl, pages, notice }) {
  element('upload').hidden = true;
  element('result').hidden = false;
  element('viewer').src = pdfUrl;
  element('download').href = pdfUrl;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  element('notes').innerHTML = pages.filter(p => p.passages.length).map(p => `
    <div class="page"><h3><small>Page ${p.pageNumber}</small>${esc(p.topic)}</h3>
    ${p.passages.map(x => `<div class="p" style="border-color:${cats[x.category]?.color}">${esc(x.text)}${x.reason ? `<em>${esc(x.reason)}</em>` : ''}</div>`).join('')}</div>`).join('');
  if (notice) element('notes').insertAdjacentHTML('afterbegin', `<p class="notice">${esc(notice)}</p>`);
}