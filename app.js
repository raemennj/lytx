const state = {
  sources: [],
  sourceById: new Map(),
  paragraphIndex: [],
  activeSourceId: null,
  searchTerm: '',
  definitions: [],
  selectionText: ''
};

const elements = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindEvents();
  state.definitions = loadDefinitions();
  renderDefinitions();
  loadSources();
  registerServiceWorker();
});

function cacheElements() {
  elements.statusLine = document.getElementById('statusLine');
  elements.sourceList = document.getElementById('sourceList');
  elements.tocList = document.getElementById('tocList');
  elements.tocMeta = document.getElementById('tocMeta');
  elements.activeTitle = document.getElementById('activeTitle');
  elements.activeMeta = document.getElementById('activeMeta');
  elements.searchForm = document.getElementById('searchForm');
  elements.searchInput = document.getElementById('searchInput');
  elements.searchSummary = document.getElementById('searchSummary');
  elements.resultsList = document.getElementById('resultsList');
  elements.content = document.getElementById('content');
  elements.refreshBtn = document.getElementById('refreshBtn');
  elements.clearSearchBtn = document.getElementById('clearSearchBtn');
  elements.definitionsList = document.getElementById('definitionsList');
  elements.selectionPanel = document.getElementById('selectionPanel');
  elements.selectionText = document.getElementById('selectionText');
  elements.definitionInput = document.getElementById('definitionInput');
  elements.definitionError = document.getElementById('definitionError');
  elements.saveDefinitionBtn = document.getElementById('saveDefinitionBtn');
  elements.cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
}

function bindEvents() {
  elements.searchForm.addEventListener('submit', onSearchSubmit);
  elements.clearSearchBtn.addEventListener('click', clearSearch);
  elements.refreshBtn.addEventListener('click', () => loadSources(true));
  elements.content.addEventListener('mouseup', handleSelection);
  elements.content.addEventListener('keyup', handleSelection);
  elements.saveDefinitionBtn.addEventListener('click', saveDefinition);
  elements.cancelSelectionBtn.addEventListener('click', hideSelectionPanel);
  elements.definitionInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      saveDefinition();
    }
  });
}

async function loadSources(forceReload) {
  setStatus('Loading sources...');
  const indexData = await fetchIndex(forceReload);
  const files = Array.isArray(indexData.files) ? indexData.files : [];
  if (!files.length) {
    setStatus('No sources found. Add files to data/index.json.');
    elements.sourceList.innerHTML = '';
    elements.content.innerHTML = '';
    renderToc(null);
    return;
  }

  const results = await Promise.allSettled(
    files.map((file) => loadSourceFile(file, forceReload))
  );

  const sources = [];
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      sources.push(result.value);
    }
  });

  state.sources = sources;
  state.sourceById = new Map(sources.map((source) => [source.id, source]));
  if (!state.activeSourceId || !state.sourceById.has(state.activeSourceId)) {
    state.activeSourceId = sources[0] ? sources[0].id : null;
  }

  buildParagraphIndex();
  renderSourceList();
  renderActiveSource();
  if (state.searchTerm) {
    runSearch(state.searchTerm);
  } else {
    renderSearchSummary(0, 0);
  }
  renderDefinitions();
  renderStatus();
}

async function fetchIndex(forceReload) {
  try {
    const url = forceReload ? `data/index.json?ts=${Date.now()}` : 'data/index.json';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('index not found');
    return await res.json();
  } catch (err) {
    return { files: [] };
  }
}

async function loadSourceFile(file, forceReload) {
  const url = forceReload ? `${file}?ts=${Date.now()}` : file;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('file load failed');
  const json = await res.json();
  const sections = Array.isArray(json.sections) ? json.sections : [];
  return {
    id: file,
    title: json.title || file,
    sections: normalizeSections(sections)
  };
}

function normalizeSections(sections) {
  return sections
    .map((section) => {
      const heading = (section.heading || '').trim();
      const raw = section.verbatimText || '';
      const paragraphs = splitParagraphs(raw);
      return { heading, paragraphs };
    })
    .filter((section) => section.paragraphs.length || section.heading);
}

function splitParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((chunk) =>
      chunk
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

function buildParagraphIndex() {
  state.paragraphIndex = [];
  state.sources.forEach((source, sourceIndex) => {
    source.key = `s${sourceIndex}`;
    source.sections.forEach((section, sectionIndex) => {
      section.paragraphs.forEach((text, paragraphIndex) => {
        state.paragraphIndex.push({
          sourceId: source.id,
          sourceKey: source.key,
          sourceTitle: source.title,
          heading: section.heading,
          text,
          sectionIndex,
          paragraphIndex,
          domId: buildParagraphId(source.key, sectionIndex, paragraphIndex)
        });
      });
    });
  });
}

function buildParagraphId(sourceKey, sectionIndex, paragraphIndex) {
  return `p-${sourceKey}-${sectionIndex}-${paragraphIndex}`;
}

function renderSourceList() {
  const list = elements.sourceList;
  list.innerHTML = '';
  if (!state.sources.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No sources found.';
    list.appendChild(empty);
    return;
  }

  state.sources.forEach((source, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-item';
    if (source.id === state.activeSourceId) {
      button.classList.add('active');
    }
    button.textContent = source.title;
    button.style.setProperty('--i', index);
    button.addEventListener('click', () => setActiveSource(source.id));
    list.appendChild(button);
  });
}

function setActiveSource(sourceId) {
  if (state.activeSourceId === sourceId) return;
  state.activeSourceId = sourceId;
  renderSourceList();
  renderActiveSource();
}

function renderActiveSource() {
  const content = elements.content;
  content.innerHTML = '';
  const source = state.sourceById.get(state.activeSourceId);
  if (!source) {
    elements.activeTitle.textContent = 'Select a source';
    elements.activeMeta.textContent = '';
    renderToc(null);
    return;
  }

  elements.activeTitle.textContent = source.title;
  const paragraphCount = source.sections.reduce(
    (total, section) => total + section.paragraphs.length,
    0
  );
  elements.activeMeta.textContent = `${source.sections.length} sections, ${paragraphCount} paragraphs`;

  source.sections.forEach((section, sectionIndex) => {
    if (section.heading) {
      const header = document.createElement('h3');
      header.textContent = section.heading;
      content.appendChild(header);
    }

    section.paragraphs.forEach((text, paragraphIndex) => {
      const paragraph = document.createElement('p');
      paragraph.className = 'para';
      paragraph.id = buildParagraphId(source.key, sectionIndex, paragraphIndex);
      appendHighlightedText(paragraph, text, state.searchTerm);
      content.appendChild(paragraph);
    });
  });

  renderToc(source);
}

function renderToc(source) {
  const list = elements.tocList;
  if (!list) return;
  list.innerHTML = '';

  if (!source) {
    if (elements.tocMeta) {
      elements.tocMeta.textContent = 'Select a source';
    }
    return;
  }

  const paragraphCount = source.sections.reduce(
    (total, section) => total + section.paragraphs.length,
    0
  );
  if (elements.tocMeta) {
    const chapterLabel = source.sections.length === 1 ? 'chapter' : 'chapters';
    const paraLabel = paragraphCount === 1 ? 'paragraph' : 'paragraphs';
    elements.tocMeta.textContent = `${source.sections.length} ${chapterLabel}, ${paragraphCount} ${paraLabel}`;
  }

  source.sections.forEach((section, sectionIndex) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'toc-section';

    const chapterButton = document.createElement('button');
    chapterButton.type = 'button';
    chapterButton.className = 'toc-chapter';
    chapterButton.textContent = section.heading || `Chapter ${sectionIndex + 1}`;
    if (section.paragraphs.length) {
      const firstId = buildParagraphId(source.key, sectionIndex, 0);
      chapterButton.addEventListener('click', () => {
        scrollToParagraph(firstId);
      });
    } else {
      chapterButton.disabled = true;
    }
    wrapper.appendChild(chapterButton);

    const paragraphs = document.createElement('div');
    paragraphs.className = 'toc-paragraphs';

    section.paragraphs.forEach((text, paragraphIndex) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'toc-paragraph';

      const number = document.createElement('span');
      number.className = 'toc-number';
      number.textContent = `${sectionIndex + 1}.${paragraphIndex + 1}`;

      const snippet = document.createElement('span');
      snippet.className = 'toc-snippet';
      snippet.textContent = makeTocSnippet(text);

      row.append(number, snippet);
      row.addEventListener('click', () => {
        const id = buildParagraphId(source.key, sectionIndex, paragraphIndex);
        scrollToParagraph(id);
      });

      paragraphs.appendChild(row);
    });

    wrapper.appendChild(paragraphs);
    list.appendChild(wrapper);
  });
}

function makeTocSnippet(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 80) return clean;
  return `${clean.slice(0, 80).trim()}...`;
}

function appendHighlightedText(node, text, term) {
  node.textContent = '';
  if (!term) {
    node.textContent = text;
    return;
  }

  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!needle) {
    node.textContent = text;
    return;
  }

  let idx = 0;
  let matchIndex = lower.indexOf(needle, idx);
  if (matchIndex === -1) {
    node.textContent = text;
    return;
  }

  while (matchIndex !== -1) {
    if (matchIndex > idx) {
      node.appendChild(document.createTextNode(text.slice(idx, matchIndex)));
    }
    const mark = document.createElement('mark');
    mark.className = 'hit';
    mark.textContent = text.slice(matchIndex, matchIndex + needle.length);
    node.appendChild(mark);

    idx = matchIndex + needle.length;
    matchIndex = lower.indexOf(needle, idx);
  }

  if (idx < text.length) {
    node.appendChild(document.createTextNode(text.slice(idx)));
  }
}

function onSearchSubmit(event) {
  event.preventDefault();
  const term = elements.searchInput.value.trim();
  if (!term) {
    clearSearch();
    return;
  }
  runSearch(term);
}

function runSearch(term) {
  state.searchTerm = term;
  const result = searchParagraphs(term);
  renderSearchSummary(result.totalHits, result.results.length);
  renderResults(result.results, term);
  renderActiveSource();
}

function clearSearch() {
  state.searchTerm = '';
  elements.searchInput.value = '';
  elements.resultsList.innerHTML = '';
  renderSearchSummary(0, 0);
  renderActiveSource();
}

function searchParagraphs(term) {
  const needle = term.toLowerCase();
  const results = [];
  let totalHits = 0;

  state.paragraphIndex.forEach((item) => {
    const count = countOccurrences(item.text, needle);
    if (count > 0) {
      totalHits += count;
      results.push({
        ...item,
        count,
        snippet: makeSnippet(item.text, term)
      });
    }
  });

  return { results, totalHits };
}

function countOccurrences(text, needleLower) {
  if (!needleLower) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  let idx = 0;
  while ((idx = lower.indexOf(needleLower, idx)) !== -1) {
    count += 1;
    idx += needleLower.length;
  }
  return count;
}

function makeSnippet(text, term) {
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx === -1) {
    return text.slice(0, 140);
  }
  const context = 60;
  const start = Math.max(0, idx - context);
  const end = Math.min(text.length, idx + needle.length + context);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

function renderSearchSummary(totalHits, paragraphs) {
  if (!state.searchTerm) {
    elements.searchSummary.textContent = 'Search across all sources.';
    return;
  }
  const hitLabel = totalHits === 1 ? 'hit' : 'hits';
  const paraLabel = paragraphs === 1 ? 'paragraph' : 'paragraphs';
  elements.searchSummary.textContent = `${totalHits} ${hitLabel} in ${paragraphs} ${paraLabel}.`;
}
function renderResults(results, term) {
  const list = elements.resultsList;
  list.innerHTML = '';
  if (!term) return;

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No matches found.';
    list.appendChild(empty);
    return;
  }

  const maxResults = 200;
  results.slice(0, maxResults).forEach((result, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'result-item';
    item.style.setProperty('--i', index);

    const title = document.createElement('div');
    title.className = 'result-title';
    const heading = result.heading ? ` - ${result.heading}` : '';
    title.textContent = `${result.sourceTitle}${heading} (${result.count})`;

    const snippet = document.createElement('div');
    snippet.className = 'result-snippet';
    appendHighlightedText(snippet, result.snippet, term);

    item.appendChild(title);
    item.appendChild(snippet);

    item.addEventListener('click', () => {
      setActiveSource(result.sourceId);
      setTimeout(() => {
        scrollToParagraph(result.domId);
      }, 0);
    });

    list.appendChild(item);
  });

  if (results.length > maxResults) {
    const note = document.createElement('div');
    note.className = 'panel-note';
    note.textContent = `Showing first ${maxResults} matches.`;
    list.appendChild(note);
  }
}

function scrollToParagraph(domId) {
  const el = document.getElementById(domId);
  if (!el) return;
  el.classList.add('spotlight');
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    el.classList.remove('spotlight');
  }, 1600);
}

function handleSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    hideSelectionPanel();
    return;
  }
  if (!elements.content.contains(selection.anchorNode)) {
    return;
  }
  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (text.length < 2 || text.length > 160) {
    hideSelectionPanel();
    return;
  }

  state.selectionText = text;
  elements.selectionText.textContent = text;
  const existing = findDefinition(text);
  elements.definitionInput.value = existing ? existing.definition : '';
  elements.definitionError.textContent = '';
  showSelectionPanel();
}

function showSelectionPanel() {
  elements.selectionPanel.classList.remove('hidden');
  elements.definitionInput.focus();
}

function hideSelectionPanel() {
  elements.selectionPanel.classList.add('hidden');
  elements.definitionError.textContent = '';
}

function saveDefinition() {
  const phrase = state.selectionText;
  const definition = elements.definitionInput.value.trim();
  if (!phrase) return;
  if (!definition) {
    elements.definitionError.textContent = 'Definition cannot be empty.';
    return;
  }

  const key = normalizePhrase(phrase);
  const existingIndex = state.definitions.findIndex((item) => item.key === key);

  if (existingIndex >= 0) {
    state.definitions[existingIndex] = {
      ...state.definitions[existingIndex],
      phrase,
      definition,
      updatedAt: Date.now()
    };
  } else {
    state.definitions.push({
      phrase,
      definition,
      key,
      createdAt: Date.now()
    });
  }

  persistDefinitions();
  renderDefinitions();
  hideSelectionPanel();
  elements.searchInput.value = phrase;
  runSearch(phrase);
}

function normalizePhrase(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

function findDefinition(phrase) {
  const key = normalizePhrase(phrase);
  return state.definitions.find((item) => item.key === key) || null;
}

function removeDefinition(key) {
  state.definitions = state.definitions.filter((item) => item.key !== key);
  persistDefinitions();
  renderDefinitions();
}

function loadDefinitions() {
  try {
    const raw = localStorage.getItem('studyGuideDefinitions');
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && item.phrase && item.definition)
      .map((item) => ({
        phrase: item.phrase,
        definition: item.definition,
        key: item.key || normalizePhrase(item.phrase),
        createdAt: item.createdAt || Date.now()
      }));
  } catch (err) {
    return [];
  }
}
function persistDefinitions() {
  localStorage.setItem('studyGuideDefinitions', JSON.stringify(state.definitions));
  renderStatus();
}

function renderDefinitions() {
  const list = elements.definitionsList;
  list.innerHTML = '';
  if (!state.definitions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No definitions yet.';
    list.appendChild(empty);
    return;
  }

  const sorted = [...state.definitions].sort((a, b) =>
    a.phrase.localeCompare(b.phrase)
  );

  sorted.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'definition-card';
    card.style.setProperty('--i', index);

    const term = document.createElement('div');
    term.className = 'definition-term';
    term.textContent = item.phrase;

    const body = document.createElement('div');
    body.className = 'definition-body';
    body.textContent = item.definition;

    const count = countOccurrencesAcrossSources(item.phrase);
    const meta = document.createElement('div');
    meta.className = 'definition-meta';
    const label = count === 1 ? 'instance' : 'instances';
    meta.textContent = `${count} ${label} found`;

    const actions = document.createElement('div');
    actions.className = 'definition-actions';

    const findBtn = document.createElement('button');
    findBtn.type = 'button';
    findBtn.className = 'ghost';
    findBtn.textContent = 'Find';
    findBtn.addEventListener('click', () => {
      elements.searchInput.value = item.phrase;
      runSearch(item.phrase);
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ghost';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      state.selectionText = item.phrase;
      elements.selectionText.textContent = item.phrase;
      elements.definitionInput.value = item.definition;
      elements.definitionError.textContent = '';
      showSelectionPanel();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      removeDefinition(item.key);
    });

    actions.append(findBtn, editBtn, removeBtn);
    card.append(term, body, meta, actions);
    list.appendChild(card);
  });
}

function countOccurrencesAcrossSources(term) {
  if (!term) return 0;
  const needle = term.toLowerCase();
  let total = 0;
  state.paragraphIndex.forEach((item) => {
    total += countOccurrences(item.text, needle);
  });
  return total;
}

function setStatus(message) {
  if (elements.statusLine) {
    elements.statusLine.textContent = message;
  }
}

function renderStatus() {
  const sourceCount = state.sources.length;
  const definitionCount = state.definitions.length;
  const sourceLabel = sourceCount === 1 ? 'source' : 'sources';
  const definitionLabel = definitionCount === 1 ? 'definition' : 'definitions';
  setStatus(`${sourceCount} ${sourceLabel} loaded. ${definitionCount} ${definitionLabel} saved locally.`);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
