/*
 * Light-Novel-Discovery-Archive - shared core
 *
 * Browser: window.ReviewCore
 * Node:    module.exports
 *
 * No dependencies. This file owns catalog validation, state helpers and the
 * list selection/sorting rules used by the light novel archive UI.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    root.ReviewCore = api;
    if (root.window && root.window !== root) root.window.ReviewCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ID_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;
  var NOVEL_KEYS = [
    'id', 'title', 'original', 'oceanOfPdfTitle', 'oceanOfPdfVolumeCount', 'author', 'genres', 'publication', 'completion',
    'releaseDate', 'score', 'summary', 'pros', 'cons', 'sources', 'cover', 'reviewedAt',
    'catalogId', 'label', 'confirmedVolumes', 'confirmedVolumeDisplay', 'tmwNumbers'
  ];

  var PUBLICATION_STATUSES = ['licensed', 'unlicensed', 'unknown'];
  var COMPLETION_STATUSES = ['completed', 'ongoing', 'hiatus', 'unknown'];
  var PUBLICATION_LABELS = {
    licensed: '국내 정식 발매',
    unlicensed: '국내 미발매',
    unknown: '발매 정보 미확인'
  };
  var COMPLETION_LABELS = {
    completed: '완결',
    ongoing: '연재 중',
    hiatus: '휴재',
    unknown: '상태 미확인'
  };

  var CATALOG_COMPLETION_LABELS = {
    completed: '완결',
    ongoing: '미완결',
    hiatus: '미완결',
    unknown: '미확인'
  };

  var SORTS = ['score-desc', 'score-asc', 'title', 'id'];
  var FILTER_DEFAULTS = {
    genre: 'all',
    publication: 'all',
    completion: 'all',
    q: '',
    favoriteOnly: false,
    view: 'active',
    sort: 'score-desc'
  };

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function fail(message) {
    throw new Error(message);
  }

  function owns(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function validId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function isIsoTimestamp(value) {
    if (typeof value !== 'string' || !TIMESTAMP_RE.test(value)) return false;
    return !isNaN(Date.parse(value));
  }

  function isIsoDate(value) {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
    var parts = value.split('-');
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    var date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
  }

  function requiredString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
      fail(path + ' must be a non-empty string.');
    }
    return value.trim();
  }

  function optionalString(value, path, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string') fail(path + ' must be a string.');
    return value.trim();
  }

  function volumeValue(value, path) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'number' && isFinite(value) && value >= 0) return String(value);
    if (typeof value === 'string') return value.trim();
    fail(path + ' must be a string or a non-negative number.');
  }

  function stringArray(value, path, options) {
    options = options || {};
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail(path + ' must be an array of strings.');
    var result = [];
    for (var i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string') {
        fail(path + '[' + i + '] must be a string.');
      }
      var item = value[i].trim();
      if (item !== '' && (!options.unique || result.indexOf(item) === -1)) {
        result.push(item);
      }
    }
    return result;
  }

  function normalizePublication(raw, path) {
    var publication = { status: 'unknown', publisher: '', volumes: '', checkedAt: '' };
    if (raw === undefined || raw === null) return publication;
    if (!isPlainObject(raw)) fail(path + ' must be an object.');

    if (raw.status !== undefined) {
      if (PUBLICATION_STATUSES.indexOf(raw.status) === -1) {
        fail(path + '.status must be one of: ' + PUBLICATION_STATUSES.join(', ') + '.');
      }
      publication.status = raw.status;
    }
    publication.publisher = optionalString(raw.publisher, path + '.publisher', '');
    publication.volumes = volumeValue(raw.volumes, path + '.volumes');
    publication.checkedAt = optionalString(raw.checkedAt, path + '.checkedAt', '');
    if (publication.checkedAt !== '' && !isIsoDate(publication.checkedAt)) {
      fail(path + '.checkedAt must be an empty string or a valid YYYY-MM-DD date.');
    }
    return publication;
  }

  function normalizeCompletion(raw, path) {
    var completion = { status: 'unknown', volumes: '' };
    if (raw === undefined || raw === null) return completion;
    if (!isPlainObject(raw)) fail(path + ' must be an object.');

    if (raw.status !== undefined) {
      if (COMPLETION_STATUSES.indexOf(raw.status) === -1) {
        fail(path + '.status must be one of: ' + COMPLETION_STATUSES.join(', ') + '.');
      }
      completion.status = raw.status;
    }
    completion.volumes = volumeValue(raw.volumes, path + '.volumes');
    return completion;
  }

  function normalizeNovel(raw, index, seenIds) {
    var path = 'Novel at index ' + index;
    if (!isPlainObject(raw)) fail(path + ' must be an object.');

    var id = requiredString(raw.id, path + '.id');
    if (!validId(id)) {
      fail(path + '.id must be a lowercase ASCII slug matching /^[a-z0-9][a-z0-9-]{0,99}$/.');
    }
    if (seenIds.has(id)) fail('Duplicate novel id "' + id + '".');
    seenIds.add(id);

    var title = requiredString(raw.title, path + '.title');
    var original = optionalString(raw.original, path + '.original', '');
    var author = optionalString(raw.author, path + '.author', '');
    var genres = stringArray(raw.genres, path + '.genres', { unique: true });

    if (!owns(raw, 'score')) fail(path + '.score is required (null for unrated).');
    var score = raw.score;
    if (score !== null) {
      if (typeof score !== 'number' || !isFinite(score) || score < 0 || score > 10) {
        fail(path + '.score must be null or a number from 0 to 10.');
      }
    }

    var publication = normalizePublication(raw.publication, path + '.publication');
    var completion = normalizeCompletion(raw.completion, path + '.completion');
    var summary = optionalString(raw.summary, path + '.summary', '');
    var pros = stringArray(raw.pros, path + '.pros');
    var cons = stringArray(raw.cons, path + '.cons');

    var sources = [];
    if (raw.sources !== undefined && raw.sources !== null) {
      if (!Array.isArray(raw.sources)) fail(path + '.sources must be an array.');
      raw.sources.forEach(function (source, sourceIndex) {
        var sourcePath = path + '.sources[' + sourceIndex + ']';
        if (!isPlainObject(source)) fail(sourcePath + ' must be an object.');
        var label = optionalString(source.label, sourcePath + '.label', '');
        var url = requiredString(source.url, sourcePath + '.url');
        if (safeUrl(url) === '') {
          fail(sourcePath + '.url must be a safe http(s) URL.');
        }
        sources.push({ label: label, url: url });
      });
    }

    var cover = { url: '', source: '' };
    if (raw.cover !== undefined && raw.cover !== null) {
      if (!isPlainObject(raw.cover)) fail(path + '.cover must be an object.');
      cover.url = optionalString(raw.cover.url, path + '.cover.url', '');
      cover.source = optionalString(raw.cover.source, path + '.cover.source', '');
      if (cover.url !== '') {
        var localCover = /^covers\/[a-z0-9][a-z0-9-]*\.(?:webp|jpg|jpeg|png)$/.test(cover.url);
        if (!localCover && safeUrl(cover.url) === '') {
          fail(path + '.cover.url must be a local cover or safe http(s) image URL.');
        }
        if (safeUrl(cover.source) === '') {
          fail(path + '.cover.source must identify the verified source page.');
        }
      }
    }

    var reviewedAt = optionalString(raw.reviewedAt, path + '.reviewedAt', '');
    if (reviewedAt !== '' && !isIsoDate(reviewedAt)) {
      fail(path + '.reviewedAt must be an empty string or a valid YYYY-MM-DD date.');
    }

    var oceanOfPdfVolumeCount = raw.oceanOfPdfVolumeCount ?? null;
    if (oceanOfPdfVolumeCount !== null &&
        (!Number.isSafeInteger(oceanOfPdfVolumeCount) || oceanOfPdfVolumeCount < 0)) {
      fail(path + '.oceanOfPdfVolumeCount must be a non-negative integer or null.');
    }

    var catalogId = optionalString(raw.catalogId, path + '.catalogId', '');
    if (catalogId && catalogId.toLowerCase() !== id) {
      fail(path + '.catalogId must match the id after converting to lowercase.');
    }
    var confirmedVolumes = raw.confirmedVolumes ?? null;
    if (confirmedVolumes !== null &&
        (!Number.isSafeInteger(confirmedVolumes) || confirmedVolumes < 0)) {
      fail(path + '.confirmedVolumes must be a non-negative integer or null.');
    }
    var tmwNumbers = raw.tmwNumbers ?? [];
    if (!Array.isArray(tmwNumbers) ||
        tmwNumbers.some(function (number) { return !Number.isSafeInteger(number) || number < 1; })) {
      fail(path + '.tmwNumbers must be an array of positive integers.');
    }

    var novel = {
      id: id,
      catalogId: catalogId,
      label: optionalString(raw.label, path + '.label', ''),
      confirmedVolumes: confirmedVolumes,
      confirmedVolumeDisplay: optionalString(raw.confirmedVolumeDisplay, path + '.confirmedVolumeDisplay', ''),
      tmwNumbers: tmwNumbers,
      title: title,
      original: original,
      oceanOfPdfTitle: optionalString(raw.oceanOfPdfTitle, path + '.oceanOfPdfTitle', ''),
      oceanOfPdfVolumeCount: oceanOfPdfVolumeCount,
      author: author,
      genres: genres,
      publication: publication,
      completion: completion,
      score: score,
      summary: summary,
      pros: pros,
      cons: cons,
      sources: sources,
      cover: cover,
      releaseDate: optionalString(raw.releaseDate, path + '.releaseDate', ''),
      reviewedAt: reviewedAt
    };

    // Keep the property order stable for readable JSON output.
    var ordered = {};
    NOVEL_KEYS.forEach(function (key) { ordered[key] = novel[key]; });
    return ordered;
  }

  function normalizeCatalog(input) {
    if (!isPlainObject(input)) fail('Catalog must be an object.');
    if (input.version !== undefined && input.version !== 1) {
      fail('Catalog version must be 1.');
    }
    if (!Array.isArray(input.novels)) fail('Catalog.novels must be an array.');
    var seenIds = new Set();
    var novels = input.novels.map(function (novel, index) {
      return normalizeNovel(novel, index, seenIds);
    });
    return { version: 1, novels: novels };
  }

  function emptyState() {
    return { version: 1, favorites: {}, deleted: {} };
  }

  function normalizeState(input) {
    if (!isPlainObject(input)) fail('State must be an object.');
    if (input.version !== undefined && input.version !== 1) {
      fail('State version must be 1.');
    }

    var favoritesInput = input.favorites === undefined || input.favorites === null
      ? {}
      : input.favorites;
    if (!isPlainObject(favoritesInput)) fail('State.favorites must be an object.');

    var favorites = {};
    Object.keys(favoritesInput).forEach(function (id) {
      if (!validId(id)) fail('State.favorites contains an invalid novel id "' + id + '".');
      var entry = favoritesInput[id];
      if (!isPlainObject(entry)) fail('State.favorites["' + id + '"] must be an object.');
      if (!isIsoTimestamp(entry.updated)) {
        fail('State.favorites["' + id + '"].updated must be an ISO timestamp.');
      }
      favorites[id] = { updated: entry.updated };
    });

    var deletedInput = input.deleted === undefined || input.deleted === null
      ? {}
      : input.deleted;
    if (!isPlainObject(deletedInput)) fail('State.deleted must be an object.');

    var deleted = {};
    Object.keys(deletedInput).forEach(function (id) {
      if (!validId(id)) fail('State.deleted contains an invalid novel id "' + id + '".');
      var entry = deletedInput[id];
      if (!isPlainObject(entry)) fail('State.deleted["' + id + '"] must be an object.');
      if (typeof entry.deleted !== 'boolean') {
        fail('State.deleted["' + id + '"].deleted must be a boolean.');
      }
      if (!isIsoTimestamp(entry.updated)) {
        fail('State.deleted["' + id + '"].updated must be an ISO timestamp.');
      }
      if (typeof entry.title !== 'string') {
        fail('State.deleted["' + id + '"].title must be a string.');
      }
      deleted[id] = {
        deleted: entry.deleted,
        updated: entry.updated,
        title: entry.title
      };
    });

    return { version: 1, favorites: favorites, deleted: deleted };
  }

  function isFavorite(state, id) {
    return !!(state && isPlainObject(state.favorites) && owns(state.favorites, id) && state.favorites[id]);
  }

  function isDeleted(state, id) {
    return !!(state && isPlainObject(state.deleted) && owns(state.deleted, id) &&
      state.deleted[id] && state.deleted[id].deleted === true);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, function (character) {
      switch (character) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return character;
      }
    });
  }

  function safeUrl(value) {
    if (typeof value !== 'string') return '';
    var trimmed = value.trim();
    if (trimmed === '') return '';
    // Reject control characters before handing anything to URL().
    if (/[\u0000-\u001F\u007F]/.test(trimmed)) return '';
    var parsed;
    try {
      parsed = new URL(trimmed);
    } catch (error) {
      return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!parsed.hostname) return '';
    return trimmed;
  }

  function scoreValue(novel) {
    return typeof novel.score === 'number' && isFinite(novel.score) ? novel.score : null;
  }

  function compareTitle(a, b) {
    var titleA = typeof a.title === 'string' && a.title !== '미확인' ? a.title : a.original || '';
    var titleB = typeof b.title === 'string' && b.title !== '미확인' ? b.title : b.original || '';
    var titleOrder = titleA.localeCompare(titleB, 'ko');
    if (titleOrder !== 0) return titleOrder;
    var idA = typeof a.id === 'string' ? a.id : '';
    var idB = typeof b.id === 'string' ? b.id : '';
    return idA.localeCompare(idB);
  }

  function compareScores(a, b, direction) {
    var scoreA = scoreValue(a);
    var scoreB = scoreValue(b);
    // Unrated novels are always last, in both directions.
    if (scoreA === null && scoreB === null) return compareTitle(a, b);
    if (scoreA === null) return 1;
    if (scoreB === null) return -1;
    if (scoreA !== scoreB) {
      return direction === 'asc' ? scoreA - scoreB : scoreB - scoreA;
    }
    return compareTitle(a, b);
  }

  function matchesQuery(novel, query) {
    if (query === '') return true;
    var haystack = [
      novel.id,
      novel.catalogId,
      novel.title,
      novel.original,
      novel.author,
      novel.label,
      novel.summary
    ].join(' ').toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function selectNovels(novels, filters, state) {
    var list = Array.isArray(novels) ? novels.filter(isPlainObject) : [];
    var options = {};
    Object.keys(FILTER_DEFAULTS).forEach(function (key) {
      options[key] = FILTER_DEFAULTS[key];
    });
    if (isPlainObject(filters)) {
      Object.keys(FILTER_DEFAULTS).forEach(function (key) {
        if (filters[key] !== undefined) options[key] = filters[key];
      });
    }

    var view = options.view === 'deleted' ? 'deleted' : 'active';
    var genre = typeof options.genre === 'string' ? options.genre : 'all';
    var publication = typeof options.publication === 'string' ? options.publication : 'all';
    var completion = typeof options.completion === 'string' ? options.completion : 'all';
    var query = typeof options.q === 'string' ? options.q.trim().toLowerCase() : '';
    var favoriteOnly = options.favoriteOnly === true;
    var sort = SORTS.indexOf(options.sort) === -1 ? 'score-desc' : options.sort;

    var selected = list.filter(function (novel) {
      var removed = isDeleted(state, novel.id);
      if (view === 'deleted' ? !removed : removed) return false;
      if (favoriteOnly && !isFavorite(state, novel.id)) return false;
      if (genre !== 'all' && (!Array.isArray(novel.genres) || novel.genres.indexOf(genre) === -1)) {
        return false;
      }
      var publicationInfo = isPlainObject(novel.publication) ? novel.publication : {};
      if (publication !== 'all' && publicationInfo.status !== publication) return false;
      var completionInfo = isPlainObject(novel.completion) ? novel.completion : {};
      if (completion === 'unfinished') {
        if (CATALOG_COMPLETION_LABELS[completionInfo.status] !== '미완결') return false;
      } else if (completion !== 'all' && completionInfo.status !== completion) return false;
      return matchesQuery(novel, query);
    });

    selected.sort(function (a, b) {
      if (sort === 'id') return a.id.localeCompare(b.id);
      if (sort === 'title') return compareTitle(a, b);
      return compareScores(a, b, sort === 'score-asc' ? 'asc' : 'desc');
    });

    return selected;
  }

  return {
    PUBLICATION_STATUSES: PUBLICATION_STATUSES,
    COMPLETION_STATUSES: COMPLETION_STATUSES,
    PUBLICATION_LABELS: PUBLICATION_LABELS,
    COMPLETION_LABELS: COMPLETION_LABELS,
    CATALOG_COMPLETION_LABELS: CATALOG_COMPLETION_LABELS,
    normalizeCatalog: normalizeCatalog,
    emptyState: emptyState,
    normalizeState: normalizeState,
    isFavorite: isFavorite,
    isDeleted: isDeleted,
    selectNovels: selectNovels,
    escapeHtml: escapeHtml,
    safeUrl: safeUrl
  };
});
