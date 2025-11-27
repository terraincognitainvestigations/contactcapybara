let allData = [];
let userIndex = {};
let likesIndex = {};
let followingData = [];
let followersData = [];

let profileOwnerUsername = '';

let topCommenters = [];
let topLikers = [];
let topContactsCommentersLoaded = 5;
let topContactsLikersLoaded = 5;

let searchInProgress = false;
let pendingSearchCallbacks = {};

// Pagination state for each search section
let commenterLoaded = 10;
let commentsLoaded = 10;
let likerLoaded = 10;
let peopleLoaded = 10;
let followersLoaded = 10;
let followingLoaded = 10;
let commentsTotal = 0;
let likersTotal = 0;
let peopleTotal = 0;
let followersTotal = 0;
let followingTotal = 0;

function safeDebounce(func, delay, id) {
  return function (...args) {
    if (pendingSearchCallbacks[id]) {
      clearTimeout(pendingSearchCallbacks[id]);
    }
    pendingSearchCallbacks[id] = setTimeout(async () => {
      if (searchInProgress) {
        cancelPendingSearches();
        return;
      }
      searchInProgress = true;
      const emergencyTimeout = setTimeout(() => {
        console.warn(`Search ${id} took too long, cancelling`);
        searchInProgress = false;
      }, 5000);
      try {
        await func.apply(this, args);
      } catch (error) {
        console.error(`Search error in ${id}:`, error);
        cancelPendingSearches();
      } finally {
        clearTimeout(emergencyTimeout);
        searchInProgress = false;
        delete pendingSearchCallbacks[id];
      }
    }, delay);
  };
}

function cancelPendingSearches() {
  Object.values(pendingSearchCallbacks).forEach(timeoutId => {
    clearTimeout(timeoutId);
  });
  pendingSearchCallbacks = {};
  searchInProgress = false;
}

function cleanHandle(s = '') {
  return s.replace(/^@/, '').replace(/^\//, '').split('?')[0];
}

const detectPlatformFromUrl = (url)=>{
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes('tiktok.'))    return 'tiktok';
    if (h.includes('instagram.')) return 'instagram';
  } catch(_) {}
  return 'unknown';
};

const profileUrlFor = (platform, username) => {
  const h = cleanHandle(username);
  if (platform === 'tiktok') return `https://www.tiktok.com/@${h}`;
  if (platform === 'instagram') return `https://www.instagram.com/${h}`;
  return `https://www.instagram.com/${h}`; // default
};

// Detect platform from data
let currentPlatform = 'instagram'; // default
const updatePlatform = () => {
  if (allData.length > 0) {
    currentPlatform = detectPlatformFromUrl(allData[0].videoUrl);
  }
};

function stripFollowTokens(s = '') {
  let x = String(s || '').normalize('NFC');
  if (!x) return '';

  x = x.replace(/[’‘`]/g, "'");

  const tokens = [
    'follow', 'follows', 'following', 'follower', 'followers',
    'volg', 'volgen', 'volgend', 'volgende', 'volgers',
    "s'abonner", 'abonner', 'abonne', 'abonné', 'abonnée', 'abonnés', 'abonnement', 'abonnements', 'suivi', 'suivie', 'suivis', 'suivies', 'suivre'
  ];

  const sep = String.raw`(?:^|[\s._\-–—|()[\]]|$)`;
  const alt = tokens.map(t => t.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|');
  const reSep = new RegExp(`${sep}(?:${alt})${sep}`, 'gi');
  x = x.replace(reSep, ' ');

  const reEdge = new RegExp(`^(?:${alt})\\s*|\\s*(?:${alt})$`, 'gi');
  x = x.replace(reEdge, ' ');

  const reTail = new RegExp(`(?:${alt})$`, 'i');
  const reHead = new RegExp(`^(?:${alt})`, 'i');
  x = x.replace(reTail, ' ').replace(reHead, ' ');

  return x.replace(/\s{2,}/g, ' ').trim();
}

function matchesPeopleQuery(p, q) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return true;
  const uname = String(p?.username || '').toLowerCase();
  const dname = stripFollowTokens(String(p?.displayName || '')).toLowerCase();
  return uname.includes(query) || dname.includes(query);
}

function parseCSV(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      if (char === '"' && (j === 0 || lines[i][j - 1] !== '\\')) {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cols.push(current.replace(/^"|"$/g, '').replace(/""/g, '"'));
        current = '';
      } else {
        current += char;
      }
    }
    cols.push(current.replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (cols.length === headers.length) {
      const row = {};
      headers.forEach((h, idx) => row[h] = cols[idx]);
      rows.push(row);
    }
  }
  return rows;
}

function loadCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function process(rows, filename) {
  if (rows.length === 0) return;
  const first = rows[0];
  if ('type' in first) {
    // Comment/like CSV: type,post_url,username,display_name,comment,profile_url
    if (!profileOwnerUsername && filename.toLowerCase().match(/_(comments|likes|comments-likes)/i)) {
      profileOwnerUsername = cleanHandle(filename.replace(/_(comments|likes|comments-likes).*?\.csv$/gi, '')).toLowerCase();
    }
    const commentsByPost = {};
    rows.forEach(row => {
      const type = row.type;
      const url = row.post_url;
      if (!commentsByPost[url]) commentsByPost[url] = { comments: [], likes: [] };
      if (type === 'comment') {
        commentsByPost[url].comments.push({
          username: cleanHandle(row.username),
          displayName: row.display_name,
          comment: row.comment,
          profileUrl: row.profile_url || ''
        });
      } else if (type === 'like') {
        commentsByPost[url].likes.push({
          username: cleanHandle(row.username),
          displayName: row.display_name,
          description: row.comment, // assuming description in comment field
          profileUrl: row.profile_url || ''
        });
      }
    });
    allData.push(...Object.entries(commentsByPost).map(([url, data]) => ({
      videoUrl: url,
      comments: data.comments,
      likes: data.likes
    })));
  } else if ('relation' in first) {
    // People CSV: relation,username,display_name,profile_url
    rows.forEach(row => {
      const item = {
        username: cleanHandle(row.username),
        displayName: row.display_name,
        profileUrl: row.profile_url || ''
      };
      if (row.relation === 'following') followingData.push(item);
      else if (row.relation === 'followers') followersData.push(item);
    });
  }
}

function buildIndexes() {
  userIndex = {};
  likesIndex = {};
  allData.forEach(video => {
    // Unique comments
    const seenC = new Set();
    video.comments.forEach(c => {
      const key = (c.username || '').toLowerCase() + '|' + (c.comment || '').trim();
      if (seenC.has(key)) return;
      seenC.add(key);
      const k = c.username || '';
      if (!userIndex[k]) userIndex[k] = { displayName: c.displayName, videos: [], profileUrl: c.profileUrl || '' };
      const vids = userIndex[k].videos;
      if (vids[vids.length - 1] !== video.videoUrl) vids.push(video.videoUrl);
    });
    // Unique likes
    const seenL = new Set();
    video.likes.forEach(l => {
      const key = (l.username || '').toLowerCase();
      if (!key || seenL.has(key)) return;
      seenL.add(key);
      if (!likesIndex[key]) likesIndex[key] = { displayName: l.displayName || '', description: l.description || '', videos: [] };
      const vids = likesIndex[key].videos;
      if (vids[vids.length - 1] !== video.videoUrl) vids.push(video.videoUrl);
    });
  });
}

function buildTopContacts() {
  topCommenters = [];
  topLikers = [];
  const hasComments = allData.some(v => v.comments.length > 0);
  const hasLikes = allData.some(v => v.likes.length > 0);
  if (!hasComments && !hasLikes) return;
  if (hasComments) {
    const usersWithCount = {};
    allData.forEach(video => {
      video.comments.forEach(c => {
        const uname = cleanHandle(c.username).toLowerCase();
        if (uname !== profileOwnerUsername) {
          if (!usersWithCount[uname]) usersWithCount[uname] = { count: 0, displayName: c.displayName, profileUrl: c.profileUrl, videos: new Set() };
          usersWithCount[uname].count++;
          usersWithCount[uname].videos.add(video.videoUrl);
        }
      });
    });
    for (let [uname, info] of Object.entries(usersWithCount)) {
      topCommenters.push({username: uname, ...info, videos: Array.from(info.videos)});
    }
    topCommenters.sort((a,b) => b.count - a.count);
  }
  if (hasLikes) {
    for (let [uname, info] of Object.entries(likesIndex)) {
      const unameLower = uname.toLowerCase();
      if (unameLower !== profileOwnerUsername) {
        const count = info.videos.length;
        topLikers.push({username: uname, count, ...info});
      }
    }
    topLikers.sort((a,b) => b.count - a.count);
  }
}

function displayCommenterResults(matches, start, count) {
  const resultsEl = document.getElementById('commenterResults');
  const toDisplay = matches.slice(start, start + count);
  toDisplay.forEach(([username, data]) => {
    const row = document.createElement('div');
    row.className = 'user';
    const unameClean = cleanHandle(username);
    let displayText;
    if (currentPlatform === 'tiktok') {
      const dn = stripFollowTokens(data.displayName || '').trim();
      const showDn = dn && dn.toLowerCase() !== unameClean.toLowerCase();
      displayText = showDn ? `<strong>${escapeHTML(dn)}</strong> — @${escapeHTML(unameClean)}` : `@${escapeHTML(unameClean)}`;
    } else {
      displayText = `@<strong>${escapeHTML(unameClean)}</strong>`;
    }
    row.innerHTML = displayText;
    row.addEventListener('click', (e) => {
      if (window.getSelection().toString()) return; // Prevent closing if text is selected
      toggleCommentUserVideos(row, data, unameClean);
    });
    resultsEl.appendChild(row);
  });
}

// Search functions copied and adapted
function safeSearchCommenters() {
  const query = (document.getElementById('searchCommenters').value || '').trim().toLowerCase();
  commenterLoaded = 10;
  const resultsEl = document.getElementById('commenterResults');
  const infoEl = document.getElementById('commenterInfo');
  const loadMoreBtn = document.getElementById('loadMoreCommenters');
  resultsEl.innerHTML = "";
  infoEl.innerHTML = "";
  loadMoreBtn.style.display = "none";

  let matches = Object.entries(userIndex);
  if (query) {
    matches = matches.filter(([username, data]) => {
      const unameClean = cleanHandle(username);
      const displayNameClean = stripFollowTokens(data.displayName || '');
      const displayedText = `@${unameClean}`;
      let searchText = displayedText.toLowerCase();
      // Add display name for TikTok search
      if (currentPlatform === 'tiktok' && displayNameClean) {
        searchText += ' ' + displayNameClean.toLowerCase();
      }
      return searchText.includes(query);
    });
  }

  if (matches.length > 10) {
    const button = document.createElement('button');
    button.className = 'btn primary open-all-btn';
    button.textContent = `Open All ${matches.length} Matches`;
    button.onclick = () => {
      collapseAllExpanded();
      const remaining = matches.length - commenterLoaded;
      displayCommenterResults(matches, commenterLoaded, remaining);
      commenterLoaded = matches.length;
      loadMoreBtn.style.display = "none";
      button.remove();
    };
    infoEl.appendChild(button);
  }

  displayCommenterResults(matches, 0, Math.min(commenterLoaded, matches.length));

  if (commenterLoaded < matches.length) {
    loadMoreBtn.style.display = "block";
  }

  loadMoreBtn.onclick = () => {
    collapseAllExpanded();
    const remaining = matches.length - commenterLoaded;
    const loadAmount = Math.min(10, remaining);
    displayCommenterResults(matches, commenterLoaded, loadAmount);
    commenterLoaded += loadAmount;
    if (commenterLoaded >= matches.length) {
      loadMoreBtn.style.display = "none";
    }
  };
}

function collapseAllExpanded() {
  document.querySelectorAll('.expanded').forEach(el => {
    const videos = el.querySelector('.videos');
    if (videos) videos.remove();
    el.classList.remove('expanded');
  });
}

function toggleCommentUserVideos(rowEl, data, uname) {
  const existing = rowEl.querySelector('.videos');
  if (existing) {
    existing.remove();
    rowEl.classList.remove('expanded');
    return;
  }

  // Close other expanded results before opening this one
  collapseAllExpanded();

  rowEl.classList.add('expanded');
  const vids = document.createElement('div');
  vids.className = 'videos';
  const profileUrl = data.profileUrl || profileUrlFor(currentPlatform, uname);
  const header = `<div style="opacity:.9;margin-bottom:4px">Profile: <a href="#" class="open-bg">${escapeHTML(uname)}</a></div>`;
  const videosHeader = `<div style="opacity:.9;margin-top:6px;margin-bottom:4px">Commented on ${data.videos.length} post(s):</div>`;
  const commentsByPost = {};
  allData.forEach(video => {
    video.comments.forEach(c => {
      if (cleanHandle(c.username) === uname) {
        if (!commentsByPost[video.videoUrl]) commentsByPost[video.videoUrl] = [];
        commentsByPost[video.videoUrl].push(c.comment);
      }
    });
  });
  const postHTML = Object.entries(commentsByPost).map(([url, comments], index) => {
    let html = '';
    if (index > 0) html += '<br>';
    const postNum = index + 1;
    const postText = `Post ${postNum}`;
    const postLink = `<div>${postText}: <a href="#" class="open-bg">${escapeHTML(url)}</a></div>`;
    const commentList = comments.map(comment => `<div>- ${escapeHTML(comment)}</div>`).join('');
    return html + postLink + commentList;
  }).join('');
  vids.innerHTML = header + videosHeader + postHTML;
  vids.addEventListener('click', e => {
    if (e.target.classList.contains('open-bg')) {
      e.preventDefault();
      const url = e.target.textContent.startsWith('http') ? e.target.textContent : profileUrl;
      window.open(url, '_blank');
    }
  });
  rowEl.appendChild(vids);
}

function safeSearchComments() {
  const query = (document.getElementById('searchComments').value || '').trim().toLowerCase();
  const excludeOwner = document.getElementById('excludeOwner').checked;
  commentsLoaded = 10;
  const resultsEl = document.getElementById('commentsResults');
  const infoEl = document.getElementById('commentsInfo');
  const loadMoreBtn = document.getElementById('loadMoreComments');
  resultsEl.innerHTML = "";
  infoEl.innerHTML = "";
  loadMoreBtn.style.display = "none";

  let matches = [];
  allData.forEach(video => {
    video.comments.forEach(c => {
      const unameLower = cleanHandle(c.username).toLowerCase();
      if (excludeOwner && unameLower === profileOwnerUsername) return;
      matches.push({ displayName: c.displayName, username: c.username, comment: c.comment, videoUrl: video.videoUrl, profileUrl: c.profileUrl });
    });
  });

  if (query) {
    matches = matches.filter(m => (m.comment || '').toLowerCase().includes(query));
  }

  commentsTotal = matches.length;

  if (commentsTotal > 10) {
    const button = document.createElement('button');
    button.className = 'btn primary open-all-btn';
    button.textContent = `Open All ${commentsTotal} Matches`;
    button.onclick = () => {
      collapseAllExpanded();
      const remaining = commentsTotal - commentsLoaded;
      displayCommentsResults(matches, commentsLoaded, remaining);
      commentsLoaded = commentsTotal;
      loadMoreBtn.style.display = "none";
      button.remove();
    };
    infoEl.appendChild(button);
  }

  displayCommentsResults(matches, 0, Math.min(commentsLoaded, commentsTotal));

  if (commentsLoaded < commentsTotal) {
    loadMoreBtn.style.display = "block";
    loadMoreBtn.onclick = () => {
      collapseAllExpanded();
      const remaining = commentsTotal - commentsLoaded;
      const loadAmount = Math.min(10, remaining);
      displayCommentsResults(matches, commentsLoaded, loadAmount);
      commentsLoaded += loadAmount;
      if (commentsLoaded >= commentsTotal) {
        loadMoreBtn.style.display = "none";
      }
    };
  }
}

function displayCommentsResults(matches, start, count) {
  const toDisplay = matches.slice(start, start + count);
  const resultsEl = document.getElementById('commentsResults');

  toDisplay.forEach(m => {
    const div = document.createElement('div');
    div.className = 'user';
    const unameClean = cleanHandle(m.username);
    let displayText;
    if (currentPlatform === 'tiktok') {
      const dn = m.displayName || unameClean;
      displayText = `<strong>${escapeHTML(dn)}</strong> — @${escapeHTML(unameClean)}<br><em>${escapeHTML(m.comment)}</em>`;
    } else {
      displayText = `<strong>@${escapeHTML(unameClean)}</strong><br><em>${escapeHTML(m.comment)}</em>`;
    }
    div.innerHTML = displayText;
    div.addEventListener('click', (e) => {
      if (window.getSelection().toString()) return; // Prevent closing if text is selected
      toggleCommentResultVideos(div, m);
    });
    resultsEl.appendChild(div);
  });
}

function toggleCommentResultVideos(rowEl, m) {
  const existing = rowEl.querySelector('.videos');
  if (existing) {
    existing.remove();
    rowEl.classList.remove('expanded');
    return;
  }

  // Close other expanded results before opening this one
  collapseAllExpanded();

  rowEl.classList.add('expanded');
  const vids = document.createElement('div');
  vids.className = 'videos';
  const unameClean = cleanHandle(m.username);
  const profileUrl = m.profileUrl || profileUrlFor(currentPlatform, unameClean);
  const postLink = `<div style="opacity:.9;margin-bottom:4px">Post: <a href="#" class="open-bg">${escapeHTML(m.videoUrl)}</a></div>`;
  const profileLink = `<div style="opacity:.9;margin-top:6px;margin-bottom:4px">Profile: <a href="#" class="open-bg">${escapeHTML(profileUrl)}</a></div>`;
  vids.innerHTML = postLink + profileLink;
  vids.addEventListener('click', e => {
    if (e.target.classList.contains('open-bg')) {
      e.preventDefault();
      const url = e.target.textContent;
      if (!url.startsWith('http')) {
        // Normally both should start with http, but fallback
        const fallbackUrl = profileUrlFor(currentPlatform, unameClean);
        window.open(fallbackUrl, '_blank');
      } else {
        window.open(url, '_blank');
      }
    }
  });
  rowEl.appendChild(vids);
}

function safeSearchLikers() {
  const q = (document.getElementById('searchLikers').value || '').trim().toLowerCase();
  likerLoaded = 10;
  const resultsEl = document.getElementById('likerResults');
  const infoEl = document.getElementById('likerInfo');
  const loadMoreBtn = document.getElementById('loadMoreLikers');
  resultsEl.innerHTML = "";
  infoEl.innerHTML = "";
  loadMoreBtn.style.display = "none";

  let matches = Object.entries(likesIndex);
  if (q) {
    matches = matches.filter(([uname, data]) => uname.toLowerCase().includes(q) || (data.displayName || '').toLowerCase().includes(q) || (data.description || '').toLowerCase().includes(q));
  }

  likersTotal = matches.length;

  if (likersTotal > 10) {
    const button = document.createElement('button');
    button.className = 'btn primary open-all-btn';
    button.textContent = `Open All ${likersTotal} Matches`;
    button.onclick = () => {
      collapseAllExpanded();
      const remaining = likersTotal - likerLoaded;
      displayLikersResults(matches, likerLoaded, remaining);
      likerLoaded = likersTotal;
      loadMoreBtn.style.display = "none";
      button.remove();
    };
    infoEl.appendChild(button);
  }

  displayLikersResults(matches, 0, Math.min(likerLoaded, likersTotal));

  if (likerLoaded < likersTotal) {
    loadMoreBtn.style.display = "block";
    loadMoreBtn.onclick = () => {
      collapseAllExpanded();
      const remaining = likersTotal - likerLoaded;
      const loadAmount = Math.min(10, remaining);
      displayLikersResults(matches, likerLoaded, loadAmount);
      likerLoaded += loadAmount;
      if (likerLoaded >= likersTotal) {
        loadMoreBtn.style.display = "none";
      }
    };
  }
}

function displayLikersResults(matches, start, count) {
  const toDisplay = matches.slice(start, start + count);
  const resultsEl = document.getElementById('likerResults');

  toDisplay.forEach(([uname, data]) => {
    const div = document.createElement('div');
    div.className = 'user';
    const clean = cleanHandle(uname);
    const dn = stripFollowTokens(data.displayName || '').trim();
    const showDn = dn && dn.toLowerCase() !== clean.toLowerCase();
    const displayPart = showDn ? `<strong>${escapeHTML(dn)}</strong> - (${escapeHTML(clean)})` : `@${escapeHTML(clean)}`;
    div.innerHTML = `<div>${displayPart}</div>`;
    if (currentPlatform === 'instagram') {
      div.addEventListener('click', (e) => {
        if (window.getSelection().toString()) return; // Prevent closing if text is selected
        handleInstagramLikerClick(div, data, clean);
      });
    } else {
      div.addEventListener('click', (e) => {
        if (window.getSelection().toString()) return; // Prevent closing if text is selected
        handleLikerRowClick(div, data.videos);
      });
    }
    resultsEl.appendChild(div);
  });
}

function handleInstagramLikerClick(rowEl, data, clean) {
  const existing = rowEl.querySelector('.videos');
  if (existing) {
    existing.remove();
    rowEl.classList.remove('expanded');
    return;
  }

  // Close other expanded results before opening this one
  collapseAllExpanded();

  rowEl.classList.add('expanded');
  const vids = document.createElement('div');
  vids.className = 'videos';
  const profileLink = `<div style="opacity:.9;margin-bottom:4px">Profile: <a href="#" class="open-bg">${escapeHTML(clean)}</a></div>`;
  const videosHeader = `<div style="opacity:.9;margin-top:6px;margin-bottom:4px">Liked posts (${data.videos.length}):</div>`;
  const links = data.videos.map(v => `<div><a href="#" class="open-bg">${escapeHTML(v)}</a></div>`).join('');
  vids.innerHTML = profileLink + videosHeader + links;
  vids.addEventListener('click', e => {
    if (e.target.classList.contains('open-bg')) {
      e.preventDefault();
      const url = e.target.textContent.startsWith('http') ? e.target.textContent : profileUrlFor(currentPlatform, clean);
      window.open(url, '_blank');
    }
  });
  rowEl.appendChild(vids);
}

function handleLikerRowClick(rowEl, vidsArr) {
  const existing = rowEl.querySelector('.videos');
  if (existing) {
    existing.remove();
    rowEl.classList.remove('expanded');
    return;
  }

  // Close other expanded results before opening this one
  collapseAllExpanded();

  rowEl.classList.add('expanded');
  const vids = document.createElement('div');
  vids.className = 'videos';
  const header = `<div style="opacity:.9;margin-top:6px">Liked posts (${vidsArr.length}):</div>`;
  const links = vidsArr.map(v => `<div><a href="#" class="open-bg">${escapeHTML(v)}</a></div>`).join('');
  vids.innerHTML = header + links;
  vids.addEventListener('click', e => {
    if (e.target.classList.contains('open-bg')) {
      e.preventDefault();
      window.open(e.target.textContent, '_blank');
    }
  });
  rowEl.appendChild(vids);
}

function displayPeopleResults(matches, start, count, resultsEl) {
  const toDisplay = matches.slice(start, start + count);
  toDisplay.forEach(p => {
    const div = document.createElement('div');
    div.className = 'user';
    const uname = cleanHandle(p.username || '');
    const dn = stripFollowTokens(p.displayName || '');
    const nameHtml = dn ? `<strong>${escapeHTML(dn)}</strong> ` : '';
    const profileUrl = p.profileUrl || profileUrlFor(currentPlatform, uname);
    div.innerHTML = `${nameHtml}<span style="opacity:.8">(@${escapeHTML(uname)})</span> — <a href="#" class="open-bg">${escapeHTML(profileUrl)}</a>`;
    div.querySelector('.open-bg').addEventListener('click', () => window.open(profileUrl, '_blank'));
    resultsEl.appendChild(div);
  });
}

function safeSearchPeople() {
  const q = (document.getElementById('searchPeople').value || '').trim().toLowerCase();
  const followingWrapper = document.getElementById('followingWrapper');
  const followersWrapper = document.getElementById('followersWrapper');
  const combinedWrapper = document.getElementById('combinedWrapper');
  const followingResultsEl = document.getElementById('followingResults');
  const followersResultsEl = document.getElementById('followersResults');
  const peopleResultsEl = document.getElementById('peopleResults');
  const followingInfoEl = document.getElementById('followingInfo');
  const followersInfoEl = document.getElementById('followersInfo');
  const peopleInfoEl = document.getElementById('peopleInfo');
  const loadMoreFollowingBtn = document.getElementById('loadMoreFollowing');
  const loadMoreFollowersBtn = document.getElementById('loadMoreFollowers');
  const loadMorePeopleBtn = document.getElementById('loadMorePeople');

  // Hide all initially
  followingWrapper.style.display = "none";
  followersWrapper.style.display = "none";
  combinedWrapper.style.display = "none";
  followingResultsEl.innerHTML = "";
  followersResultsEl.innerHTML = "";
  peopleResultsEl.innerHTML = "";
  followingInfoEl.textContent = "";
  followersInfoEl.textContent = "";
  peopleInfoEl.textContent = "";
  loadMoreFollowingBtn.style.display = "none";
  loadMoreFollowersBtn.style.display = "none";
  loadMorePeopleBtn.style.display = "none";

  const hasFollowing = followingData.length > 0;
  const hasFollowers = followersData.length > 0;
  const bothPresent = hasFollowing && hasFollowers;

  if (bothPresent) {
    // Show both wrappers
    followingWrapper.style.display = "block";
    followersWrapper.style.display = "block";
    followersWrapper.style.marginTop = "20px";

    // Search following
    const fMatchesFull = followingData.filter(p => matchesPeopleQuery(p, q));
    followingTotal = fMatchesFull.length;
    followingLoaded = 10;

    followingInfoEl.innerHTML = "";
    if (followingTotal > 10) {
      const button = document.createElement('button');
      button.className = 'btn primary open-all-btn';
      button.textContent = `Open All ${followingTotal} Matches`;
      button.onclick = () => {
        collapseAllExpanded();
        const remaining = followingTotal - followingLoaded;
        displayPeopleResults(fMatchesFull, followingLoaded, remaining, followingResultsEl);
        followingLoaded = followingTotal;
        loadMoreFollowingBtn.style.display = "none";
        button.remove();
      };
      followingInfoEl.appendChild(button);
    }

    if (followingTotal > 0) {
      displayPeopleResults(fMatchesFull, 0, Math.min(followingLoaded, followingTotal), followingResultsEl);
      if (followingLoaded < followingTotal) {
        loadMoreFollowingBtn.style.display = "block";
        loadMoreFollowingBtn.onclick = () => {
          collapseAllExpanded();
          const remaining = followingTotal - followingLoaded;
          const loadAmount = Math.min(10, remaining);
          displayPeopleResults(fMatchesFull, followingLoaded, loadAmount, followingResultsEl);
          followingLoaded += loadAmount;
          if (followingLoaded >= followingTotal) {
            loadMoreFollowingBtn.style.display = "none";
          }
        };
      }
    } else {
      followingResultsEl.textContent = "Geen resultaten.";
    }

    // Search followers
    const rMatchesFull = followersData.filter(p => matchesPeopleQuery(p, q));
    followersTotal = rMatchesFull.length;
    followersLoaded = 10;

    followersInfoEl.innerHTML = "";
    if (followersTotal > 10) {
      const button = document.createElement('button');
      button.className = 'btn primary open-all-btn';
      button.textContent = `Open All ${followersTotal} Matches`;
      button.onclick = () => {
        collapseAllExpanded();
        const remaining = followersTotal - followersLoaded;
        displayPeopleResults(rMatchesFull, followersLoaded, remaining, followersResultsEl);
        followersLoaded = followersTotal;
        loadMoreFollowersBtn.style.display = "none";
        button.remove();
      };
      followersInfoEl.appendChild(button);
    }

    if (followersTotal > 0) {
      displayPeopleResults(rMatchesFull, 0, Math.min(followersLoaded, followersTotal), followersResultsEl);
      if (followersLoaded < followersTotal) {
        loadMoreFollowersBtn.style.display = "block";
        loadMoreFollowersBtn.onclick = () => {
          collapseAllExpanded();
          const remaining = followersTotal - followersLoaded;
          const loadAmount = Math.min(10, remaining);
          displayPeopleResults(rMatchesFull, followersLoaded, loadAmount, followersResultsEl);
          followersLoaded += loadAmount;
          if (followersLoaded >= followersTotal) {
            loadMoreFollowersBtn.style.display = "none";
          }
        };
      }
    } else {
      followersResultsEl.textContent = "Geen resultaten.";
    }
  } else {
    // Show combined wrapper
    combinedWrapper.style.display = "block";

    const fMatchesFull = followingData.filter(p => matchesPeopleQuery(p, q));
    const rMatchesFull = followersData.filter(p => matchesPeopleQuery(p, q));
    peopleTotal = fMatchesFull.length + rMatchesFull.length;

    if (!peopleTotal) {
      peopleResultsEl.textContent = "Geen resultaten.";
      return;
    }



    // Separate counters for each section
    let followingLoaded = Math.min(10, fMatchesFull.length);
    let followersLoaded = Math.min(10, rMatchesFull.length);
    let totalLoaded = followingLoaded + followersLoaded;

    // Clear and populate initial results
    peopleResultsEl.innerHTML = "";

    // Add Following section
    const followingSection = document.createElement('div');
    followingSection.className = 'combined-section';
    peopleResultsEl.appendChild(followingSection);

    // Add Followers section
    const followersSection = document.createElement('div');
    followersSection.className = 'combined-section';
    peopleResultsEl.appendChild(followersSection);

    if (peopleTotal > totalLoaded) {
      const button = document.createElement('button');
      button.className = 'btn primary open-all-btn';
      button.textContent = `Open All ${peopleTotal} Matches`;
      button.onclick = () => {
        collapseAllExpanded();
        const remainingFollowing = Math.max(0, fMatchesFull.length - followingLoaded);
        if (remainingFollowing > 0) displayPeopleResults(fMatchesFull, followingLoaded, remainingFollowing, followingSection);
        followingLoaded = fMatchesFull.length;

        const remainingFollowers = Math.max(0, rMatchesFull.length - followersLoaded);
        if (remainingFollowers > 0) displayPeopleResults(rMatchesFull, followersLoaded, remainingFollowers, followersSection);
        followersLoaded = rMatchesFull.length;

        loadMorePeopleBtn.style.display = "none";
        button.remove();
      };
      peopleInfoEl.appendChild(button);
    }

    // Display initial results
    const fInitial = fMatchesFull.slice(0, followingLoaded);
    const rInitial = rMatchesFull.slice(0, followersLoaded);
    if (fInitial.length > 0) displayPeopleResults(fInitial, 0, fInitial.length, followingSection);
    if (rInitial.length > 0) displayPeopleResults(rInitial, 0, rInitial.length, followersSection);

    if (totalLoaded < peopleTotal) {
      loadMorePeopleBtn.style.display = "block";
      loadMorePeopleBtn.onclick = () => {
        collapseAllExpanded();
        const loadAmount = 10;
        const remainingFollowing = fMatchesFull.length - followingLoaded;
        const remainingFollowers = rMatchesFull.length - followersLoaded;

        if (remainingFollowing > 0) {
          const loadFollowing = Math.min(loadAmount, remainingFollowing);
          const fToAdd = fMatchesFull.slice(followingLoaded, followingLoaded + loadFollowing);
          if (fToAdd.length > 0) displayPeopleResults(fToAdd, 0, fToAdd.length, followingSection);
          followingLoaded += loadFollowing;
        }

        if (remainingFollowers > 0) {
          const loadFollowers = Math.min(loadAmount, remainingFollowers);
          const rToAdd = rMatchesFull.slice(followersLoaded, followersLoaded + loadFollowers);
          if (rToAdd.length > 0) displayPeopleResults(rToAdd, 0, rToAdd.length, followersSection);
          followersLoaded += loadFollowers;
        }

        totalLoaded = followingLoaded + followersLoaded;
        if (totalLoaded >= peopleTotal) {
          loadMorePeopleBtn.style.display = "none";
        }
      };
    }
  }
}

function displayTopContacts() {
  const hasBoth = topCommenters.length > 0 && topLikers.length > 0;
  const topCommentersWrapper = document.getElementById('topCommentersWrapper');
  const topLikersWrapper = document.getElementById('topLikersWrapper');
  const singleWrapper = document.getElementById('singleWrapper');

  if (hasBoth) {
    // Show two separate wrappers, hide single
    topCommentersWrapper.style.display = "block";
    topLikersWrapper.style.display = "block";
    singleWrapper.style.display = "none";

    // Populate commenters
    const comResultsEl = document.getElementById('topCommentersResults');
    comResultsEl.innerHTML = "";
    const titleCom = document.createElement('div');
    titleCom.className = 'section-title';
    titleCom.textContent = 'Top Commenters';
    comResultsEl.appendChild(titleCom);
    const toShowComm = topCommenters.slice(0, topContactsCommentersLoaded);
    toShowComm.forEach(data => {
      const row = document.createElement('div');
      row.className = 'user';
      const unameClean = data.username;
      let displayText;
      if (currentPlatform === 'tiktok') {
        const dn = stripFollowTokens(data.displayName || '').trim();
        const showDn = dn && dn.toLowerCase() !== unameClean.toLowerCase();
        displayText = showDn ? `<strong>${escapeHTML(dn)}</strong> — @${escapeHTML(unameClean)} (${data.count} comments)` : `@${escapeHTML(unameClean)} (${data.count} comments)`;
      } else {
        displayText = `@<strong>${escapeHTML(unameClean)}</strong> (${data.count} comments)`;
      }
      row.innerHTML = displayText;
      row.addEventListener('click', (e) => {
        if (window.getSelection().toString()) return; // Prevent closing if text is selected
        toggleCommentUserVideos(row, data, unameClean);
      });
      comResultsEl.appendChild(row);
    });

    const loadMoreComBtn = document.getElementById('loadMoreTopCommenters');
    loadMoreComBtn.style.display = topContactsCommentersLoaded < topCommenters.length ? "block" : "none";
    loadMoreComBtn.onclick = () => {
      collapseAllExpanded();
      topContactsCommentersLoaded = Math.min(topContactsCommentersLoaded + 5, topCommenters.length);
      displayTopContacts();
    };

    // Populate likers
    const likResultsEl = document.getElementById('topLikersResults');
    likResultsEl.innerHTML = "";
    const titleLik = document.createElement('div');
    titleLik.className = 'section-title';
    titleLik.textContent = 'Top Likers';
    likResultsEl.appendChild(titleLik);
    const toShowLik = topLikers.slice(0, topContactsLikersLoaded);
    toShowLik.forEach(data => {
      const row = document.createElement('div');
      row.className = 'user';
      const uname = data.username;
      const clean = cleanHandle(uname);
      const dn = stripFollowTokens(data.displayName || '').trim();
      const showDn = dn && dn.toLowerCase() !== clean.toLowerCase();
      const countText = `(${data.count} likes)`;
      const displayPart = showDn ? `<strong>${escapeHTML(dn)}</strong> - (@${escapeHTML(clean)}) ${countText}` : `@${escapeHTML(clean)} ${countText}`;
      row.innerHTML = `<div>${displayPart}</div>`;
      if (currentPlatform === 'instagram') {
        row.addEventListener('click', () => handleInstagramLikerClick(row, data, clean));
      } else {
        row.addEventListener('click', () => handleLikerRowClick(row, data.videos));
      }
      likResultsEl.appendChild(row);
    });

    const loadMoreLikBtn = document.getElementById('loadMoreTopLikers');
    loadMoreLikBtn.style.display = topContactsLikersLoaded < topLikers.length ? "block" : "none";
    loadMoreLikBtn.onclick = () => {
      collapseAllExpanded();
      topContactsLikersLoaded = Math.min(topContactsLikersLoaded + 5, topLikers.length);
      displayTopContacts();
    };
  } else {
    // Only one type or none, show single wrapper
    topCommentersWrapper.style.display = "none";
    topLikersWrapper.style.display = "none";
    singleWrapper.style.display = "block";

    const resultsEl = document.getElementById('topcontactsResults');
    const loadMoreBtn = document.getElementById('loadMoreTopContacts');
    resultsEl.innerHTML = "";
    loadMoreBtn.style.display = "none";
    if (!topCommenters.length && !topLikers.length) {
      resultsEl.textContent = "No top contacts to display.";
      return;
    }
    // Top Commenters
    if (topCommenters.length > 0) {
      const section = document.createElement('div');
      section.className = 'section-title';
      section.textContent = 'Top Commenters';
      resultsEl.appendChild(section);
      const toShowComm = topCommenters.slice(0, topContactsCommentersLoaded);
      toShowComm.forEach(data => {
        const row = document.createElement('div');
        row.className = 'user';
        const unameClean = data.username;
        let displayText;
        if (currentPlatform === 'tiktok') {
          const dn = stripFollowTokens(data.displayName || '').trim();
          const showDn = dn && dn.toLowerCase() !== unameClean.toLowerCase();
          displayText = showDn ? `<strong>${escapeHTML(dn)}</strong> — @${escapeHTML(unameClean)} (${data.count} comments)` : `@${escapeHTML(unameClean)} (${data.count} comments)`;
        } else {
          displayText = `@<strong>${escapeHTML(unameClean)}</strong> (${data.count} comments)`;
        }
        row.innerHTML = displayText;
        row.addEventListener('click', (e) => {
          if (window.getSelection().toString()) return; // Prevent closing if text is selected
          toggleCommentUserVideos(row, data, unameClean);
        });
        resultsEl.appendChild(row);
      });
    }
    // Top Likers
    if (topLikers.length > 0) {
      const section = document.createElement('div');
      section.className = 'section-title';
      section.textContent = 'Top Likers';
      resultsEl.appendChild(section);
      const toShowLik = topLikers.slice(0, topContactsLikersLoaded);
      toShowLik.forEach(data => {
        const row = document.createElement('div');
        row.className = 'user';
        const uname = data.username;
        const clean = cleanHandle(uname);
        const dn = stripFollowTokens(data.displayName || '').trim();
        const showDn = dn && dn.toLowerCase() !== clean.toLowerCase();
        const countText = `(${data.count} likes)`;
        const displayPart = showDn ? `<strong>${escapeHTML(dn)}</strong> - (@${escapeHTML(clean)}) ${countText}` : `@${escapeHTML(clean)} ${countText}`;
        row.innerHTML = `<div>${displayPart}</div>`;
        if (currentPlatform === 'instagram') {
          row.addEventListener('click', (e) => {
            if (window.getSelection().toString()) return; // Prevent closing if text is selected
            handleInstagramLikerClick(row, data, clean);
          });
        } else {
          row.addEventListener('click', (e) => {
            if (window.getSelection().toString()) return; // Prevent closing if text is selected
            handleLikerRowClick(row, data.videos);
          });
        }
        resultsEl.appendChild(row);
      });
    }
    if (topContactsCommentersLoaded < topCommenters.length || topContactsLikersLoaded < topLikers.length) {
      loadMoreBtn.style.display = "block";
      loadMoreBtn.onclick = () => {
        collapseAllExpanded();
        if (topContactsCommentersLoaded < topCommenters.length) {
          topContactsCommentersLoaded = Math.min(topContactsCommentersLoaded + 5, topCommenters.length);
        }
        if (topContactsLikersLoaded < topLikers.length) {
          topContactsLikersLoaded = Math.min(topContactsLikersLoaded + 5, topLikers.length);
        }
        displayTopContacts();
      };
    }
  }
}

function escapeHTML(str) {
  return String(str || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, '&#39;');
}

  // Tab switching functionality
  function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.search-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.search-tab').forEach(btn => btn.classList.remove('active'));

    // Show selected tab
    document.getElementById(`${tabName}Tab`).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    if (tabName === 'commenters') {
      safeSearchCommenters();
    } else if (tabName === 'comments') {
      safeSearchComments();
    } else if (tabName === 'likers') {
      safeSearchLikers();
    } else if (tabName === 'people') {
      safeSearchPeople();
    } else if (tabName === 'topcontacts') {
      displayTopContacts();
    }
  }

  // Event listeners
  document.getElementById('loadCsv').addEventListener('click', async () => {
    const loadBtn = document.getElementById('loadCsv');
    const statusEl = document.getElementById('loadStatus');
    const searchSection = document.getElementById('searchSection');

    const files = document.getElementById('csvFile').files;
    if (!files.length) {
      statusEl.textContent = 'Please select CSV file(s) first';
      statusEl.className = 'error';
      return;
    }

    loadBtn.disabled = true;
    statusEl.textContent = 'Loading...';
    statusEl.className = '';

    try {
    allData = [];
    userIndex = {};
    likesIndex = {};
    followingData = [];
    followersData = [];
    topCommenters = [];
    topLikers = [];
    topContactsCommentersLoaded = 5;
    topContactsLikersLoaded = 5;

    const texts = await Promise.all(Array.from(files).map(loadCSV));
    texts.forEach((text, i) => {
      const rows = parseCSV(text);
      process(rows, files[i].name);
    });

    buildIndexes();
    buildTopContacts();
    updatePlatform();
    if (currentPlatform === 'tiktok') {
      document.querySelector('#commentersTab h3').textContent = 'Search Commenters by Username & Display Name';
    }
    searchSection.style.display = 'block';
    statusEl.textContent = `Loaded ${files.length} CSV file(s) successfully. Ready to search.`;
    statusEl.className = 'success';

    // Hide/show tabs based on available data
    const tabs = {
      commenters: Object.keys(userIndex).length > 0,
      comments: allData.some(v => v.comments.length > 0),
      likers: allData.some(v => v.likes.length > 0),
      people: followingData.length > 0 || followersData.length > 0,
      topcontacts: allData.some(v => v.comments.length > 0) || allData.some(v => v.likes.length > 0)
    };

    // Update people tab label based on data
    const peopleTab = document.querySelector('.search-tab[data-tab="people"]');
    const peopleHeading = document.querySelector('#peopleTab h3');
    if (peopleTab) {
    if (followingData.length > 0 && followersData.length > 0) {
      peopleTab.textContent = 'Search Following & Followers';
      if (peopleHeading) peopleHeading.textContent = 'Search Following & Followers';
    } else if (followingData.length > 0) {
      peopleTab.textContent = 'Search Following';
      if (peopleHeading) peopleHeading.textContent = 'Search Following';
    } else if (followersData.length > 0) {
      peopleTab.textContent = 'Search Followers';
      if (peopleHeading) peopleHeading.textContent = 'Search Followers';
    }
    }

    document.querySelectorAll('.search-tab').forEach(btn => {
      const tabName = btn.dataset.tab;
      btn.style.display = tabs[tabName] ? 'inline-block' : 'none';
    });

    // Activate first available tab
    const firstTab = Object.keys(tabs).find(key => tabs[key]) || 'commenters';
    switchTab(firstTab);

    // Scroll to search section
    searchSection.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    console.error('Load error:', error);
    statusEl.textContent = 'Error loading CSV files';
    statusEl.className = 'error';
  } finally {
    loadBtn.disabled = false;
  }
});

// Tab switching
document.querySelectorAll('.search-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;
    switchTab(tabName);
  });
});

// Search listener - trigger search on the active tab
function triggerActiveSearch() {
  const activePanel = document.querySelector('.search-panel.active');
  if (!activePanel) return;

  const input = activePanel.querySelector('input');
  if (input) {
    // Debounce the active search
    if (activePanel.id === 'commentersTab') safeDebounce(safeSearchCommenters, 300, 'searchCommenters')();
    else if (activePanel.id === 'commentsTab') safeDebounce(safeSearchComments, 300, 'searchComments')();
    else if (activePanel.id === 'likersTab') safeDebounce(safeSearchLikers, 300, 'searchLikers')();
    else if (activePanel.id === 'peopleTab') safeDebounce(safeSearchPeople, 300, 'searchPeople')();
  }
}

document.getElementById('searchCommenters').addEventListener('input', () => triggerActiveSearch());
document.getElementById('searchComments').addEventListener('input', () => triggerActiveSearch());
document.getElementById('searchLikers').addEventListener('input', () => triggerActiveSearch());
document.getElementById('searchPeople').addEventListener('input', () => triggerActiveSearch());
document.getElementById('excludeOwner').addEventListener('change', () => triggerActiveSearch());

// Back to Top Button functionality
const backToTopBtn = document.getElementById('backToTopBtn');

function toggleBackToTopBtn() {
  if (window.pageYOffset > 300) {
    backToTopBtn.classList.add('show');
  } else {
    backToTopBtn.classList.remove('show');
  }
}

function scrollToTop() {
  const searchSection = document.getElementById('searchSection');
  if (searchSection) {
    searchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
}

backToTopBtn.addEventListener('click', scrollToTop);
window.addEventListener('scroll', toggleBackToTopBtn);
