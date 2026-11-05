/* CertStudy - flashcards and notes (uses window.CS from app.js) */
(function () {
  'use strict';

  var CS = window.CS;
  if (!CS) return;

  var INTERVALS = [0, 1, 3, 7, 16, 35, 70];
  var DAY = 86400000;

  /* ------------------------------------------------------------- images */

  var DB_NAME = 'certstudy-images';
  var STORE = 'imgs';
  var dbPromise = null;
  var urlCache = {};

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('This browser cannot store images')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Image store failed')); };
    });
    return dbPromise;
  }

  function imgPut(blob) {
    var key = CS.uid();
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = function () { resolve(key); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function imgGet(key) {
    if (!key) return Promise.resolve(null);
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    });
  }

  function imgDel(key) {
    if (!key) return Promise.resolve();
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    });
  }

  function imgUrl(key) {
    if (!key) return Promise.resolve(null);
    if (urlCache[key]) return Promise.resolve(urlCache[key]);
    return imgGet(key).then(function (blob) {
      if (!blob) return null;
      var url = URL.createObjectURL(blob);
      urlCache[key] = url;
      return url;
    });
  }

  function imgNode(key, cls) {
    var img = CS.h('img', { class: cls || 'shot', attrs: { alt: '' } });
    img.style.display = 'none';
    imgUrl(key).then(function (url) {
      if (!url) return;
      img.src = url;
      img.style.display = 'block';
    }).catch(function () { });
    return img;
  }

  function compress(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) { reject(new Error('That file is not an image')); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var image = new Image();
        image.onload = function () {
          var max = 1400;
          var scale = Math.min(1, max / Math.max(image.width || 1, image.height || 1));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('Could not process that image'));
          }, 'image/jpeg', 0.72);
        };
        image.onerror = function () { reject(new Error('That image could not be read')); };
        image.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('That file could not be read')); };
      reader.readAsDataURL(file);
    });
  }

  function dropZone(opts) {
    var input = CS.h('input', {
      attrs: {
        type: 'file',
        accept: 'image/*',
        multiple: opts.multiple ? 'multiple' : null
      }
    });
    input.style.display = 'none';

    var hint = CS.h('span', { class: 'small muted', text: opts.hint || 'Drag an image here, or tap to choose one' });
    var zone = CS.h('div', {
      class: 'drop',
      attrs: { role: 'button', tabindex: '0' }
    }, [
      CS.h('strong', { text: opts.title || 'Add image' }),
      hint,
      input
    ]);

    function handle(files) {
      var list = Array.prototype.slice.call(files || []).filter(function (f) {
        return /^image\//.test(f.type || '');
      });
      if (!list.length) { CS.toast('Drop an image file'); return; }
      if (!opts.multiple) list = [list[0]];
      opts.onFiles(list);
    }

    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { handle(input.files); input.value = ''; });

    ['dragenter', 'dragover'].forEach(function (name) {
      zone.addEventListener(name, function (ev) {
        ev.preventDefault();
        zone.classList.add('over');
      });
    });
    ['dragleave', 'dragend'].forEach(function (name) {
      zone.addEventListener(name, function () { zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (ev) {
      ev.preventDefault();
      zone.classList.remove('over');
      handle(ev.dataTransfer ? ev.dataTransfer.files : null);
    });
    return zone;
  }

  /* --------------------------------------------------------- flashcards */

  function decks() {
    var s = CS.state();
    if (!Array.isArray(s.decks)) s.decks = [];
    if (!s.decks.length) {
      s.decks.push({ id: CS.uid(), name: 'CTFL', createdAt: Date.now() });
      CS.save();
    }
    return s.decks;
  }

  function cards() {
    var s = CS.state();
    if (!Array.isArray(s.cards)) s.cards = [];
    return s.cards;
  }

  function deckById(id) {
    return decks().filter(function (d) { return d.id === id; })[0] || null;
  }

  function cardsOf(deckId) {
    return cards().filter(function (c) { return c.deckId === deckId; });
  }

  function dueCards(deckId) {
    var now = Date.now();
    return cards().filter(function (c) {
      if (deckId && c.deckId !== deckId) return false;
      return !c.due || c.due <= now;
    });
  }

  function cardStats(deckId) {
    var list = deckId ? cardsOf(deckId) : cards();
    var due = list.filter(function (c) { return !c.due || c.due <= Date.now(); }).length;
    var learned = list.filter(function (c) { return (c.level || 0) >= 3; }).length;
    return { total: list.length, due: due, learned: learned };
  }

  function gradeCard(card, good) {
    card.level = good ? Math.min(INTERVALS.length - 1, (card.level || 0) + 1) : 0;
    card.due = Date.now() + INTERVALS[card.level] * DAY;
    card.lastAt = Date.now();
    if (good) card.reviews = (card.reviews || 0) + 1;
  }

  /* -------------------------------------------------------------- notes */

  function notes() {
    var s = CS.state();
    if (!Array.isArray(s.notes)) s.notes = [];
    return s.notes;
  }

  function noteById(id) {
    return notes().filter(function (n) { return n.id === id; })[0] || null;
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function snippet(text) {
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > 140 ? clean.slice(0, 140) + '…' : clean;
  }

  function dateLabel(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleDateString(); } catch (e) { return ''; }
  }

  /* ------------------------------------------------------------- views */

  function pageHead(eyebrow, title, lede) {
    return CS.h('div', { class: 'head' }, [
      CS.h('span', { class: 'eyebrow', text: eyebrow }),
      CS.h('h1', { class: 'h1', text: title }),
      lede ? CS.h('p', { class: 'lede', text: lede }) : null
    ]);
  }

  function cardsHome() {
    CS.nav('cards');
    document.title = 'Flashcards - CertStudy';
    var all = cardStats(null);
    var wrap = CS.h('div', { class: 'wrap' }, [
      pageHead('Active recall', 'Flashcards', 'Make your own decks from the syllabus, with an image on each card. Cards come back on a spaced schedule: again, then 1, 3, 7, 16, 35, 70 days.')
    ]);

    wrap.appendChild(CS.h('section', { class: 'card' }, [
      CS.h('div', { class: 'grid grid-3' }, [
        CS.h('div', { class: 'stat' }, [CS.h('div', { class: 'stat-num', text: String(all.total) }), CS.h('div', { class: 'stat-lbl', text: 'Cards' })]),
        CS.h('div', { class: 'stat' }, [CS.h('div', { class: 'stat-num', text: String(all.due) }), CS.h('div', { class: 'stat-lbl', text: 'Due now' })]),
        CS.h('div', { class: 'stat' }, [CS.h('div', { class: 'stat-num', text: String(all.learned) }), CS.h('div', { class: 'stat-lbl', text: 'Learned' })])
      ]),
      CS.h('div', { class: 'row tight' }, [
        CS.h('button', {
          class: 'btn primary', attrs: { type: 'button' }, text: 'Study what is due',
          on: { click: function () { CS.navigate('#/cards/study/all'); } }
        }),
        CS.h('button', {
          class: 'btn', attrs: { type: 'button' }, text: 'New card',
          on: { click: function () { CS.navigate('#/cards/new/' + (decks()[0] || {}).id); } }
        })
      ])
    ]));

    var newDeck = CS.h('input', { attrs: { type: 'text', placeholder: 'New deck name', maxlength: '40' } });
    newDeck.className = 'field';
    var deckSection = CS.h('section', { class: 'card' }, [
      CS.h('h2', { class: 'h2', text: 'Decks' }),
      CS.h('div', { class: 'stack' }, decks().map(deckRow))
    ]);
    deckSection.appendChild(CS.h('div', { class: 'row tight' }, [
      newDeck,
      CS.h('button', {
        class: 'btn small primary', attrs: { type: 'button' }, text: 'Add deck',
        on: {
          click: function () {
            var name = (newDeck.value || '').trim();
            if (!name) { CS.toast('Give the deck a name'); return; }
            decks().push({ id: CS.uid(), name: name, createdAt: Date.now() });
            CS.save();
            CS.toast('Deck added');
            CS.render();
          }
        }
      })
    ]));
    wrap.appendChild(deckSection);
    return wrap;
  }

  function deckRow(deck) {
    var st = cardStats(deck.id);
    return CS.h('div', { class: 'deckrow' }, [
      CS.h('div', { class: 'stack' }, [
        CS.h('strong', { text: deck.name }),
        CS.h('span', { class: 'small muted', text: plural(st.total, 'card') + ' · ' + st.due + ' due' })
      ]),
      CS.h('div', { class: 'row tight' }, [
        CS.h('button', {
          class: 'btn small', attrs: { type: 'button' }, text: 'Open',
          on: { click: function () { CS.navigate('#/cards/deck/' + deck.id); } }
        }),
        CS.h('button', {
          class: 'btn small primary', attrs: { type: 'button' }, text: 'Study',
          on: { click: function () { CS.navigate('#/cards/study/' + deck.id); } }
        })
      ])
    ]);
  }

  function deckView(deckId) {
    CS.nav('cards');
    var deck = deckId === 'all' ? { id: 'all', name: 'All decks' } : deckById(deckId);
    if (!deck) return backCard('Deck not found', '#/cards');
    document.title = deck.name + ' - Flashcards';
    var list = deckId === 'all' ? cards() : cardsOf(deckId);
    var wrap = CS.h('div', { class: 'wrap' }, [
      CS.h('div', { class: 'head' }, [
        CS.h('a', { class: 'small', href: '#/cards', text: 'Back to flashcards' }),
        CS.h('h1', { class: 'h1', text: deck.name }),
        CS.h('p', { class: 'small muted', text: plural(list.length, 'card') + ' in this deck.' })
      ]),
      CS.h('div', { class: 'row tight' }, [
        CS.h('button', {
          class: 'btn primary', attrs: { type: 'button' }, text: 'Add card',
          on: { click: function () { CS.navigate('#/cards/new/' + deckId); } }
        }),
        CS.h('button', {
          class: 'btn', attrs: { type: 'button' }, text: 'Study due',
          on: { click: function () { CS.navigate('#/cards/study/' + deckId); } }
        })
      ])
    ]);

    if (!list.length) {
      wrap.appendChild(CS.h('section', { class: 'card' }, [
        CS.h('p', { class: 'small muted', text: 'No cards yet. Add the first one.' })
      ]));
      return wrap;
    }

    var box = CS.h('section', { class: 'card' });
    list.forEach(function (card) {
      box.appendChild(CS.h('div', { class: 'cardrow' }, [
        card.img ? imgNode(card.img, 'thumb') : null,
        CS.h('div', { class: 'stack' }, [
          CS.h('strong', { text: card.front }),
          CS.h('span', { class: 'small muted', text: snippet(card.back) }),
          CS.h('span', { class: 'tiny muted', text: 'Level ' + (card.level || 0) + (card.due && card.due > Date.now() ? ' · next ' + dateLabel(card.due) : ' · due now') })
        ]),
        CS.h('div', { class: 'row tight' }, [
          CS.h('button', {
            class: 'btn small ghost', attrs: { type: 'button' }, text: 'Edit',
            on: { click: function () { CS.navigate('#/cards/edit/' + card.id); } }
          }),
          CS.h('button', {
            class: 'btn small danger', attrs: { type: 'button' }, text: 'Delete',
            on: {
              click: function () {
                CS.confirmDialog({
                  title: 'Delete this card?',
                  message: card.front,
                  confirmLabel: 'Delete'
                }).then(function (ok) {
                  if (!ok) return;
                  var s = CS.state();
                  s.cards = cards().filter(function (c) { return c.id !== card.id; });
                  CS.save();
                  if (card.img) imgDel(card.img);
                  CS.toast('Card deleted');
                  CS.render();
                });
              }
            }
          })
        ])
      ]));
    });
    wrap.appendChild(box);
    return wrap;
  }

  function cardEditor(cardId, deckId) {
    CS.nav('cards');
    var card = cardId ? cards().filter(function (c) { return c.id === cardId; })[0] : null;
    if (cardId && !card) return backCard('Card not found', '#/cards');
    document.title = (card ? 'Edit card' : 'New card') + ' - CertStudy';

    var front = CS.h('textarea', { attrs: { rows: '2', placeholder: 'Front: the prompt or question' } });
    var back = CS.h('textarea', { attrs: { rows: '3', placeholder: 'Back: the answer or explanation' } });
    var select = CS.h('select');
    decks().forEach(function (d) {
      var opt = CS.h('option', { attrs: { value: d.id }, text: d.name });
      if ((card && card.deckId === d.id) || (!card && deckId === d.id)) opt.setAttribute('selected', 'selected');
      select.appendChild(opt);
    });
    if (card) { front.value = card.front || ''; back.value = card.back || ''; }
    front.className = 'field';
    back.className = 'field';
    select.className = 'field';

    var images = card && card.img ? [card.img] : [];
    var thumbs = CS.h('div', { class: 'thumbs' });
    function paint() {
      CS.clear(thumbs);
      thumbs.appendChild(dropZone({
        multiple: false,
        title: 'Add an image to this card',
        hint: 'Drag a file here or tap',
        onFiles: function (files) {
          compress(files[0]).then(function (blob) { return imgPut(blob); }).then(function (key) {
            if (images[0]) imgDel(images[0]);
            urlCache[key] = null;
            delete urlCache[key];
            urlCache[key] = URL.createObjectURL ? undefined : undefined;
            cards_removeUrl(key);
            imgUrl(key).then(function (url) {
              if (url) urlCache[key] = url;
            });
            imgGet(key).then(function (blob2) {
              if (blob2) { urlCache[key] = URL.createObjectURL(blob2); }
              draw();
            });
            setImage(key);
          }).catch(function (err) { CS.toast(err.message || 'Image failed'); });
        }
      }));
      if (imgId) {
        var thumb = imgNode(imgId, 'thumb');
        var remove = CS.h('button', {
          class: 'btn small ghost', attrs: { type: 'button' }, text: 'Remove image',
          on: {
            click: function () {
              imgDel(imgId);
              imgId = null;
              CS.save();
              draw();
            }
          }
        });
        thumbs.appendChild(CS.h('div', { class: 'thumb-wrap' }, [thumb, remove]));
      }
    }
    var imgId = images[0] || null;
    function setImage(key) {
      var previous = imgId;
      imgId = key;
      if (previous && previous !== key) imgDel(previous);
      cards_removeUrl(key);
      imgUrl(key).then(function (url) { if (url) urlCache[key] = url; draw(); });
    }
    function draw() {
      CS.clear(thumbs);
      thumbs.appendChild(LocalDrop());
      if (imgId) {
        thumbs.appendChild(CS.h('div', { class: 'thumb-wrap' }, [
          imgNode(imgId, 'thumb'),
          CS.h('button', {
            class: 'btn small ghost', attrs: { type: 'button' }, text: 'Remove image',
            on: {
              click: function () {
                imgDel(imgId);
                imgId = null;
                draw();
              }
            }
          })
        ]));
      }
    }
    function LocalDrop() {
      return dropZone({
        multiple: false,
        title: 'Card image',
        hint: 'Drag a file here or tap to choose',
        onFiles: function (files) {
          compress(files[0]).then(function (blob) {
            return imgPut(blob).then(function (key) { return { key: key, blob: blob }; });
          }).then(function (res) {
            imgDel(imgId);
            imgId = res.key;
            urlCache[res.key] = URL.createObjectURL(res.blob);
            draw();
          }).catch(function (err) { CS.toast(err.message || 'Image failed'); });
        }
      });
    }
    draw();

    var busy = false;
    function save() {
      var frontText = (front.value || '').trim();
      var backText = (back.value || '').trim();
      if (!frontText) { CS.toast('The front side is empty'); return; }
      var s = CS.state();
      if (card) {
        card.front = frontText;
        card.back = backText;
        card.deckId = select.value || card.deckId;
        card.img = imgId;
      } else {
        cards().push({
          id: CS.uid(),
          deckId: select.value || (decks()[0] || {}).id,
          front: frontText,
          back: backText,
          img: imgId,
          level: 0,
          due: Date.now(),
          createdAt: Date.now()
        });
      }
      CS.save();
      busy = true;
      CS.toast(card ? 'Card saved' : 'Card added');
      CS.navigate('#/cards/deck/' + (select.value || 'all'));
    }

    var wrap = CS.h('div', { class: 'wrap' }, [
      CS.h('div', { class: 'head' }, [
        CS.h('a', { class: 'small', href: '#/cards', text: 'Back to flashcards' }),
        CS.h('h1', { class: 'h1', text: card ? 'Edit card' : 'New card' })
      ]),
      CS.h('section', { class: 'card stack' }, [
        CS.h('label', { class: 'lbl' }, [CS.h('span', { text: 'Deck' }), select]),
        CS.h('label', { class: 'lbl' }, [CS.h('span', { text: 'Front' }), front]),
        CS.h('label', { class: 'lbl' }, [CS.h('span', { text: 'Back' }), back]),
        thumbs
      ]),
      CS.h('div', { class: 'row tight' }, [
        CS.h('button', { class: 'btn primary', attrs: { type: 'button' }, text: 'Save card', on: { click: function () { if (!busy) save(); } } }),
        CS.h('button', { class: 'btn ghost', attrs: { type: 'button' }, text: 'Cancel', on: { click: function () { CS.navigate('#/cards'); } } })
      ])
    ]);
    return wrap;
  }

  function studyView(deckId) {
    CS.nav('cards');
    var pool = dueCards(deckId === 'all' ? null : deckId);
    if (!pool.length) {
      return backCard('Nothing due in this deck', '#/cards');
    }
    var queue = pool.slice(0, 40);
    var index = 0;
    var revealed = false;
    document.title = 'Study - CertStudy';

    var cardHost = CS.h('div', { class: 'card stack' }, []);
    var counter = CS.h('span', { class: 'small muted', text: '' });
    var wrap = CS.h('div', { class: 'wrap' }, [
      CS.h('div', { class: 'head' }, [
        CS.h('a', { class: 'small', href: '#/cards', text: 'Back to flashcards' }),
        CS.h('h1', { class: 'h1', text: 'Study' })
      ]),
      CS.h('div', { class: 'row tight' }, [counter]),
      cardHost
    ]);

    function paint() {
      CS.clear(cardHost);
      if (index >= queue.length) {
        counter.textContent = 'Done';
        cardHost.appendChild(CS.h('h2', { class: 'h2', text: 'Session finished' }));
        cardHost.appendChild(CS.h('p', { class: 'small muted', text: 'Cards you found hard come back sooner.' }));
        cardHost.appendChild(CS.h('button', {
          class: 'btn primary', attrs: { type: 'button' }, text: 'Back to flashcards',
          on: { click: function () { CS.navigate('#/cards'); } }
        }));
        return;
      }
      var card = queue[index];
      counter.textContent = (index + 1) + ' of ' + queue.length;
      cardHost.appendChild(CS.h('div', { class: 'row tight' }, [
        CS.h('span', { class: 'tiny muted', text: (deckById(card.deckId) || {}).name || '' }),
        CS.h('span', { class: 'tiny muted', text: 'level ' + (card.level || 0) })
      ]));
      cardHost.appendChild(CS.h('h2', { class: 'h2 flash-front', text: card.front }));
      if (card.img) cardHost.appendChild(imgNode(card.img, 'shot'));

      if (!revealed) {
        cardHost.appendChild(CS.h('button', {
          class: 'btn primary', attrs: { type: 'button' }, text: 'Show answer',
          on: { click: function () { revealed = true; paint(); } }
        }));
      } else {
        cardHost.appendChild(CS.h('p', { class: 'flash-back', text: card.back || '' }));
        cardHost.appendChild(CS.h('div', { class: 'row tight' }, [
          CS.h('button', {
            class: 'btn small danger', attrs: { type: 'button' }, text: 'Again',
            on: { click: function () { gradeCard(card, false); CS.save(); index += 1; revealed = false; paint(); } }
          }),
          CS.h('button', {
            class: 'btn small primary', attrs: { type: 'button' }, text: 'Got it',
            on: { click: function () { gradeCard(card, true); CS.save(); index += 1; revealed = false; paint(); } }
          })
        ]));
      }
    }
    paint();
    return wrap;
  }

  /* -------------------------------------------------------------- notes */

  function notesHome() {
    CS.nav('notes');
    document.title = 'Notes - CertStudy';
    var search = CS.h('input', { attrs: { type: 'search', placeholder: 'Search notes', maxlength: '80' } });
    search.className = 'field';
    var listBox = CS.h('div', { class: 'stack' });

    function paint() {
      CS.clear(listBox);
      var q = (search.value || '').toLowerCase().trim();
      var list = notes().slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
      if (q) {
        list = list.filter(function (n) {
          return ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.tags || '')).toLowerCase().indexOf(q) >= 0;
        });
      }
      if (!list.length) {
        listBox.appendChild(CS.h('p', { class: 'small muted', text: 'No notes yet. Make one — you can drag images straight into it.' }));
        return;
      }
      list.forEach(function (note) {
        listBox.appendChild(CS.h('a', { class: 'noterow', href: '#/notes/edit/' + note.id }, [
          CS.h('div', { class: 'stack' }, [
            CS.h('strong', { text: note.title || 'Untitled note' }),
            CS.h('span', { class: 'small muted', text: snippet(note.body) }),
            CS.h('span', { class: 'tiny muted', text: dateLabel(note.updated) + (note.imgs && note.imgs.length ? ' · ' + note.imgs.length + ' image' + (note.imgs.length > 1 ? 's' : '') : '') })
          ]),
          note.imgs && note.imgs.length ? imgNode(note.imgs[0], 'thumb') : null
        ]));
      });
    }
    search.addEventListener('input', paint);
    paint();

    return CS.h('div', { class: 'wrap' }, [
      pageHead('Long-form memory', 'Notes', 'Write what you want to remember, drop images into a note, tag it, and find it again by search.'),
      CS.h('div', { class: 'row tight' }, [
        CS.h('button', {
          class: 'btn primary', attrs: { type: 'button' }, text: 'New note',
          on: { click: function () { CS.navigate('#/notes/edit/new'); } }
        }),
        search
      ]),
      CS.h('section', { class: 'card' }, [listBox])
    ]);
  }

  function noteEditor(noteId) {
    CS.nav('notes');
    var isNew = !noteId || noteId === 'new';
    var note = isNew ? null : noteById(noteId);
    if (!isNew && !note) return backCard('Note not found', '#/notes');
    if (isNew) {
      note = {
        id: CS.uid(), title: '', body: '', tags: '', imgs: [], createdAt: Date.now(), updated: Date.now()
      };
      notes().push(note);
      CS.save();
    }
    document.title = (note.title || 'Note') + ' - CertStudy';

    var title = CS.h('input', { attrs: { type: 'text', placeholder: 'Title', maxlength: '120' } });
    title.className = 'field';
    title.value = note.title || '';
    var body = CS.h('textarea', { attrs: { rows: '10', placeholder: 'Write here…' } });
    body.className = 'field note-body';
    body.value = note.body || '';
    var tags = CS.h('input', { attrs: { type: 'text', placeholder: 'Tags, comma separated', maxlength: '120' } });
    tags.className = 'field';
    tags.value = note.tags || '';

    var saved = CS.h('span', { class: 'tiny muted', text: 'Saved on this device' });
    var thumbs = CS.h('div', { class: 'thumbs' });

    function paintThumbs() {
      CS.clear(thumbs);
      (note.imgs || []).forEach(function (key) {
        thumbs.appendChild(CS.h('div', { class: 'thumb-wrap' }, [
          imgNode(key, 'thumb'),
          CS.h('button', {
            class: 'btn small ghost', attrs: { type: 'button' }, text: 'Remove',
            on: {
              click: function () {
                note.imgs = (note.imgs || []).filter(function (k) { return k !== key; });
                imgDel(key);
                saveNow();
                paintThumbs();
              }
            }
          })
        ]));
      });
      thumbs.appendChild(dropZone({
        multiple: true,
        title: 'Drop images into this note',
        hint: 'Drag files here, or tap',
        onFiles: function (files) {
          saved.textContent = 'Adding images…';
          Promise.all(files.map(function (file) {
            return compress(file).then(imgPut);
          })).then(function (keys) {
            note.imgs = (note.imgs || []).concat(keys);
            saveNow();
            paintThumbs();
            saved.textContent = 'Saved · ' + keys.length + ' image' + (keys.length > 1 ? 's' : '') + ' added';
          }).catch(function (err) {
            saved.textContent = 'Image failed: ' + (err.message || err);
          });
        }
      }));
    }

    var timer = null;
    function saveNow() {
      note.title = title.value || '';
      note.body = body.value || '';
      note.tags = tags.value || '';
      note.updated = Date.now();
      CS.save();
    }
    function queueSave() {
      saved.textContent = 'Saving…';
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        saveNow();
        saved.textContent = 'Saved · ' + new Date().toLocaleTimeString();
      }, 500);
    }
    [title, body, tags].forEach(function (el) { el.addEventListener('input', queueSave); });

    paintThumbs();

    return CS.h('div', { class: 'wrap' }, [
      CS.h('div', { class: 'head' }, [
        CS.h('a', { class: 'small', href: '#/notes', text: 'Back to notes' }),
        saved
      ]),
      CS.h('section', { class: 'card stack' }, [title, body, tags, thumbs]),
      CS.h('div', { class: 'row tight' }, [
        CS.h('button', {
          class: 'btn primary', attrs: { type: 'button' }, text: 'Save and close',
          on: { click: function () { saveNow(); CS.navigate('#/notes'); } }
        }),
        CS.h('button', {
          class: 'btn small danger', attrs: { type: 'button' }, text: 'Delete note',
          on: {
            click: function () {
              CS.confirmDialog({
                title: 'Delete this note?',
                message: note.title || 'Untitled note',
                confirmLabel: 'Delete'
              }).then(function (ok) {
                if (!ok) return;
                var s = CS.state();
                s.notes = notes().filter(function (n) { return n.id !== note.id; });
                CS.save();
                (note.imgs || []).forEach(imgDel);
                CS.toast('Note deleted');
                CS.navigate('#/notes');
              });
            }
          }
        })
      ])
    ]);
  }

  function backCard(title, hash) {
    return CS.h('div', { class: 'wrap' }, [
      CS.h('div', { class: 'card stack' }, [
        CS.h('h2', { class: 'h2', text: title }),
        CS.h('button', {
          class: 'btn primary', attrs: { type: 'button' }, text: 'Go back',
          on: { click: function () { CS.navigate(hash); } }
        })
      ])
    ]);
  }

  function cards_removeUrl(key) {
    if (urlCache[key]) {
      try { URL.revokeObjectURL(urlCache[key]); } catch (e) { }
      delete urlCache[key];
    }
  }

  /* ----------------------------------------------------------- register */

  CS.views.cards = function (p) {
    if (p[1] === 'deck' && p[2]) return deckView(p[2]);
    if (p[1] === 'study' && p[2]) return studyView(p[2]);
    if (p[1] === 'edit' && p[2]) return cardEditor(p[2]);
    if (p[1] === 'new') return cardEditor(null, p[2]);
    return cardsHome();
  };

  CS.views.notes = function (p) {
    if (p[1] === 'edit') return noteEditor(p[2] || 'new');
    return notesHome();
  };
})();
