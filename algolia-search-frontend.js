/**
 * LCB Real Estate — Algolia InstantSearch Frontend v2.1
 * 
 * Arquitectura real del sitio (mapeada desde el Designer):
 * 
 * FILTROS:
 *   - Operación:        checkboxes estáticos [fs-cmsfilter-field="tipo"] values: Renta/Venta
 *   - Ubicación:        CMS collection [fs-cmsfilter-field="ciudad"] (typo original: "cuidad")
 *   - Tipo propiedad:   CMS collection [fs-cmsfilter-field="tipopropiedades"]
 *   - Search:           input [fs-cmsfilter-field="*"]
 *   - Clear:            [fs-cmsfilter-element="clear"]
 *   - Count:            [fs-cmsfilter-element="results-count"]
 * 
 * LISTA PRINCIPAL:
 *   - Wrapper:  .Collection.List.Wrapper.2  (DynamoWrapper)
 *   - List:     .Collection.List.3          (DynamoList)
 *   - Items:    .w-dyn-item
 * 
 * ESTRATEGIA:
 *   1. Capturar el primer .w-dyn-item como template ANTES de limpiar
 *   2. Vaciar la lista y renderizar solo los hits de Algolia (24 por página)
 *   3. Los checkboxes y labels existentes se sincronizan con Algolia via eventos
 *   4. Swiper se inicializa SOLO en las cards renderizadas
 *   5. Lightbox de Webflow se re-inicializa tras cada render
 */

(function () {
  'use strict';

  // Solo en /propiedades (listado), no en páginas de detalle
  const path = window.location.pathname;
  if (!path.startsWith('/propiedades') || path.split('/').filter(Boolean).length > 1) return;

  // ─── CONFIG ─────────────────────────────────────────────────────────────────
  const ALGOLIA_APP_ID     = 'AT36ZPQLUN';
  const ALGOLIA_SEARCH_KEY = '52fd152e763367fee66a55bc3c557051';
  const INDEX_NAME         = 'lcb_propiedades';
  const HITS_PER_PAGE      = 24;

  // ─── SELECTORES (basados en estructura real del Designer) ────────────────────
  const SEL = {
    form:         '[fs-cmsfilter-element="filters"]',
    listWrapper:  '.w-dyn-list',           // el DynamoWrapper renderizado
    list:         '.w-dyn-items',          // el DynamoList renderizado
    emptyState:   '.w-dyn-empty',
    searchInput:  '[fs-cmsfilter-field="*"]',
    clearBtn:     '[fs-cmsfilter-element="clear"]',
    countEl:      '[fs-cmsfilter-element="results-count"]',
    itemsCount:   '[fs-cmsfilter-element="items-count"]',
    afBar:        '#af-bar',
    // Checkboxes de Operación (estáticos)
    tipoLabels:   '[fs-cmsfilter-field="tipo"]',
    // Labels de Ciudad (dinámicos CMS)
    ciudadLabels: '[fs-cmsfilter-field="ciudad"], [fs-cmsfilter-field="cuidad"]',
    // Labels de Tipo de Propiedad (dinámicos CMS)
    tipoProps:    '[fs-cmsfilter-field="tipopropiedades"]',
  };

  // ─── ESTADO ─────────────────────────────────────────────────────────────────
  let templateCard  = null;
  let swiperInstances = [];
  let isInitialized = false;

  // ─── HELPERS ────────────────────────────────────────────────────────────────
  function waitFor(fn, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function check() {
        const r = fn();
        if (r) return resolve(r);
        if (Date.now() - start > timeout) return reject(new Error('Timeout'));
        setTimeout(check, 100);
      })();
    });
  }

  function loadScript(src, check) {
    return new Promise(resolve => {
      if (check()) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = resolve; // no bloquear si falla
      document.head.appendChild(s);
    });
  }

  // ─── CAPTURAR TEMPLATE CARD ──────────────────────────────────────────────────
  function captureTemplate() {
    const list = document.querySelector(SEL.list);
    if (!list) return null;
    const first = list.querySelector('.w-dyn-item');
    if (!first) return null;
    templateCard = first.cloneNode(true);
    // Limpiar estado de Swiper del template
    templateCard.querySelectorAll('.swiper-initialized').forEach(el => {
      el.classList.remove('swiper-initialized');
    });
    templateCard.querySelectorAll('.swiper-wrapper').forEach(el => {
      el.style.transform = '';
      el.style.transitionDuration = '';
    });
    return templateCard;
  }

  // ─── DESTRUIR SWIPERS ────────────────────────────────────────────────────────
  function destroyAllSwipers() {
    swiperInstances.forEach(sw => { try { sw.destroy(true, true); } catch(e) {} });
    swiperInstances = [];
  }

  // ─── INICIALIZAR SWIPERS EN CARDS NUEVAS ────────────────────────────────────
  function initSwipers(container) {
    if (!window.Swiper) return;
    container.querySelectorAll('.swiper:not(.swiper-initialized)').forEach(el => {
      try {
        const sw = new window.Swiper(el, {
          slidesPerView: 1,
          loop: false,
          pagination: { el: el.querySelector('.swiper-pagination'), clickable: true },
          navigation: {
            nextEl: el.querySelector('.swiper-button-next'),
            prevEl: el.querySelector('.swiper-button-prev'),
          },
          observer: true,
          observeParents: true,
          lazy: { loadPrevNext: true },
        });
        swiperInstances.push(sw);
      } catch(e) { console.warn('[LCB] Swiper:', e.message); }
    });
  }

  // ─── RENDER DE UNA CARD DESDE UN HIT DE ALGOLIA ─────────────────────────────
  function renderCard(hit) {
    if (!templateCard) return null;
    const card = templateCard.cloneNode(true);

    // Link a la página CMS nativa
    const pageUrl = hit.pageUrl || `/propiedades/${hit.slug}`;
    card.querySelectorAll('a').forEach(a => {
      if (!a.href.includes('whatsapp') && !a.href.includes('wa.me')) {
        a.href = pageUrl;
      }
    });

    // Imagen principal
    const img = card.querySelector('img');
    if (img && hit.featuredImageUrl) {
      img.src = hit.featuredImageUrl;
      img.srcset = '';
      img.alt = hit.name || '';
      img.loading = 'lazy';
    }

    // Rellenar textos usando querySelectorAll para ser resiliente
    const allText = [...card.querySelectorAll('*')].filter(e => !e.children.length);

    // Título (h3/h4/h5 o el texto más largo que no sea precio)
    const titleEl = card.querySelector('h3, h4, h5') ||
      allText.find(e => e.textContent.trim().length > 10 && !/\$|MXN|USD/.test(e.textContent) && e.tagName !== 'A');
    if (titleEl) titleEl.textContent = hit.name || '';

    // Precio
    const priceEl = allText.find(e => /\$|MXN|USD/.test(e.textContent));
    if (priceEl) priceEl.textContent = hit.precioDisplay || '';

    // Ubicación
    const locEl = allText.find(e =>
      (e.className || '').toLowerCase().match(/ciudad|city|ubicaci|location/)
    );
    if (locEl) locEl.textContent = hit.locationFull || '';

    // Metros cuadrados
    const metrosEl = allText.find(e =>
      (e.className || '').toLowerCase().match(/metro|area|m2/)
    );
    if (metrosEl && hit.metrosDisplay) metrosEl.textContent = `${hit.metrosDisplay} m²`;

    // Tipo de operación badge
    const opEl = allText.find(e =>
      (e.className || '').toLowerCase().match(/operaci|operation|tipo-op/)
    );
    if (opEl) opEl.textContent = hit.operationType || '';

    // Etiqueta badge
    const tagEl = card.querySelector('[class*="etiqueta"], [class*="badge"], [class*="tag"]');
    if (tagEl) {
      tagEl.textContent = hit.etiqueta || '';
      tagEl.style.display = hit.etiqueta ? '' : 'none';
    }

    card.setAttribute('data-objectid', hit.objectID);
    card.setAttribute('data-slug', hit.slug);

    return card;
  }

  // ─── ACTUALIZAR CONTADORES ───────────────────────────────────────────────────
  function updateCounts(nbHits) {
    document.querySelectorAll(SEL.countEl).forEach(el => {
      el.textContent = nbHits + ' ';
    });
    document.querySelectorAll(SEL.itemsCount).forEach(el => {
      el.textContent = nbHits;
    });
  }

  // ─── ACTUALIZAR ACTIVE FILTER TAGS ──────────────────────────────────────────
  function updateAfBar(activeFilters) {
    const bar = document.querySelector(SEL.afBar);
    if (!bar) return;
    bar.innerHTML = '';
    if (!activeFilters.length) return;

    activeFilters.forEach(({ label, onRemove }) => {
      const tag = document.createElement('span');
      tag.className = 'af-tag';
      const btn = document.createElement('button');
      btn.innerHTML = '&#x2715;';
      btn.onclick = onRemove;
      tag.append(document.createTextNode(label), btn);
      bar.appendChild(tag);
    });

    if (activeFilters.length > 1) {
      const cl = document.createElement('span');
      cl.className = 'af-clear';
      cl.textContent = 'Limpiar todo';
      cl.onclick = () => document.querySelector(SEL.clearBtn)?.click();
      bar.appendChild(cl);
    }
  }

  // ─── LÓGICA PRINCIPAL DE ALGOLIA ─────────────────────────────────────────────
  async function initAlgolia() {
    if (isInitialized) return;
    isInitialized = true;

    // Cargar librerías
    await loadScript(
      'https://cdn.jsdelivr.net/npm/algoliasearch@4/dist/algoliasearch-lite.umd.js',
      () => window.algoliasearch
    );
    await loadScript(
      'https://cdn.jsdelivr.net/npm/instantsearch.js@4/dist/instantsearch.production.min.js',
      () => window.instantsearch
    );

    await waitFor(() => window.algoliasearch && window.instantsearch);

    const list = document.querySelector(SEL.list);
    if (!list) { console.warn('[LCB Algolia] Lista no encontrada'); return; }

    // Capturar template ANTES de vaciar
    if (!captureTemplate()) { console.warn('[LCB Algolia] Template card no encontrado'); return; }

    // ─── Estado de filtros activos (sincronizado con checkboxes del DOM) ─────
    const activeRefinements = {
      operationType: new Set(),
      city:          new Set(),
      propertyType:  new Set(),
    };

    let searchQuery = '';
    let currentPage = 0;
    let totalPages  = 0;
    let totalHits   = 0;

    // ─── Función de búsqueda en Algolia ─────────────────────────────────────
    async function doSearch() {
      const filters = [];

      if (activeRefinements.operationType.size) {
        const vals = [...activeRefinements.operationType].map(v => `operationType:"${v}"`).join(' OR ');
        filters.push(`(${vals})`);
      }
      if (activeRefinements.city.size) {
        const vals = [...activeRefinements.city].map(v => `city:"${v}"`).join(' OR ');
        filters.push(`(${vals})`);
      }
      if (activeRefinements.propertyType.size) {
        const vals = [...activeRefinements.propertyType].map(v => `propertyType:"${v}"`).join(' OR ');
        filters.push(`(${vals})`);
      }

      const body = {
        query:   searchQuery,
        filters: filters.join(' AND '),
        hitsPerPage: HITS_PER_PAGE,
        page:    currentPage,
        attributesToRetrieve: [
          'name','slug','featuredImageUrl','precioDisplay','locationFull',
          'metrosDisplay','operationType','propertyType','city',
          'etiqueta','destacada','pageUrl','objectID'
        ],
      };

      const res = await fetch(
        `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${INDEX_NAME}/query`,
        {
          method: 'POST',
          headers: {
            'X-Algolia-Application-Id': ALGOLIA_APP_ID,
            'X-Algolia-API-Key':        ALGOLIA_SEARCH_KEY,
            'Content-Type':             'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) throw new Error(`Algolia ${res.status}`);
      return res.json();
    }

    // ─── Renderizar resultados ───────────────────────────────────────────────
    async function render() {
      try {
        const data = await doSearch();
        const { hits, nbHits, nbPages } = data;

        totalHits  = nbHits;
        totalPages = nbPages;

        // Limpiar Swipers y lista
        destroyAllSwipers();
        list.innerHTML = '';

        // Empty state
        const emptyState = document.querySelector(SEL.emptyState);

        if (!hits.length) {
          if (emptyState) emptyState.style.display = '';
          updateCounts(0);
          updateAfBar(getActiveFilterTags());
          renderPagination();
          return;
        }

        if (emptyState) emptyState.style.display = 'none';

        // Render cards
        const fragment = document.createDocumentFragment();
        hits.forEach(hit => {
          const card = renderCard(hit);
          if (card) fragment.appendChild(card);
        });
        list.appendChild(fragment);

        // Init Swipers
        setTimeout(() => initSwipers(list), 150);

        // Re-trigger Lightbox Webflow
        try { window.Webflow?.require('lightbox')?.ready?.(); } catch(e) {}

        updateCounts(nbHits);
        updateAfBar(getActiveFilterTags());
        renderPagination();

        // Scroll suave al tope de la lista
        list.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

      } catch(e) {
        console.error('[LCB Algolia] Search error:', e.message);
      }
    }

    // ─── Active filter tags ──────────────────────────────────────────────────
    function getActiveFilterTags() {
      const tags = [];
      activeRefinements.operationType.forEach(v => tags.push({
        label: v,
        onRemove: () => {
          activeRefinements.operationType.delete(v);
          syncCheckbox('tipo', v, false);
          currentPage = 0; render();
        }
      }));
      activeRefinements.city.forEach(v => tags.push({
        label: v,
        onRemove: () => {
          activeRefinements.city.delete(v);
          syncCheckbox('ciudad', v, false);
          currentPage = 0; render();
        }
      }));
      activeRefinements.propertyType.forEach(v => tags.push({
        label: v,
        onRemove: () => {
          activeRefinements.propertyType.delete(v);
          syncCheckbox('tipopropiedades', v, false);
          currentPage = 0; render();
        }
      }));
      return tags;
    }

    function syncCheckbox(field, value, checked) {
      document.querySelectorAll(`[fs-cmsfilter-field="${field}"]`).forEach(label => {
        const val = label.getAttribute('fs-cmsfilter-value') || label.textContent.trim();
        if (val === value) {
          const wrap = label.closest('.w-checkbox, .w-form-formradioinput-field');
          const cb = wrap?.querySelector('input[type="checkbox"], input[type="radio"]');
          if (cb) cb.checked = checked;
        }
      });
    }

    // ─── Paginación simple ───────────────────────────────────────────────────
    function renderPagination() {
      let pag = document.getElementById('lcb-pagination');
      if (!pag) {
        pag = document.createElement('div');
        pag.id = 'lcb-pagination';
        pag.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;margin:40px 0;flex-wrap:wrap;';
        list.parentElement?.appendChild(pag);
      }
      pag.innerHTML = '';

      if (totalPages <= 1) return;

      const makeBtn = (label, page, disabled, active) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.disabled = disabled;
        btn.style.cssText = `
          padding:8px 16px;border-radius:8px;border:1.5px solid ${active ? '#e8720c' : '#ddd'};
          background:${active ? '#e8720c' : '#fff'};color:${active ? '#fff' : '#333'};
          cursor:${disabled ? 'default' : 'pointer'};font-size:14px;font-weight:${active ? '600' : '400'};
          opacity:${disabled ? '0.4' : '1'};
        `;
        if (!disabled) btn.onclick = () => { currentPage = page; render(); window.scrollTo({top:0,behavior:'smooth'}); };
        return btn;
      };

      pag.appendChild(makeBtn('← Anterior', currentPage - 1, currentPage === 0, false));

      const start = Math.max(0, currentPage - 2);
      const end   = Math.min(totalPages - 1, currentPage + 2);
      for (let i = start; i <= end; i++) {
        pag.appendChild(makeBtn(i + 1, i, false, i === currentPage));
      }

      pag.appendChild(makeBtn('Siguiente →', currentPage + 1, currentPage >= totalPages - 1, false));
    }

    // ─── CONECTAR CHECKBOXES ESTÁTICOS (Operación: Renta/Venta) ─────────────
    document.querySelectorAll(SEL.tipoLabels).forEach(label => {
      const value = label.getAttribute('fs-cmsfilter-value');
      if (!value) return;
      const wrap = label.closest('.w-checkbox');
      const cb   = wrap?.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.addEventListener('change', () => {
        if (cb.checked) activeRefinements.operationType.add(value);
        else            activeRefinements.operationType.delete(value);
        currentPage = 0; render();
      });
    });

    // ─── CONECTAR CHECKBOXES DINÁMICOS DE CIUDAD ─────────────────────────────
    document.querySelectorAll(SEL.ciudadLabels).forEach(label => {
      const value = label.textContent.trim() || label.getAttribute('fs-cmsfilter-value');
      if (!value) return;
      const wrap = label.closest('.w-checkbox');
      const cb   = wrap?.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.addEventListener('change', () => {
        if (cb.checked) activeRefinements.city.add(value);
        else            activeRefinements.city.delete(value);
        currentPage = 0; render();
      });
    });

    // ─── CONECTAR CHECKBOXES DINÁMICOS DE TIPO DE PROPIEDAD ──────────────────
    document.querySelectorAll(SEL.tipoProps).forEach(label => {
      const value = label.textContent.trim() || label.getAttribute('fs-cmsfilter-value');
      if (!value) return;
      const wrap = label.closest('.w-checkbox');
      const cb   = wrap?.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.addEventListener('change', () => {
        if (cb.checked) activeRefinements.propertyType.add(value);
        else            activeRefinements.propertyType.delete(value);
        currentPage = 0; render();
      });
    });

    // ─── SEARCH INPUT ────────────────────────────────────────────────────────
    const searchInput = document.querySelector(SEL.searchInput);
    if (searchInput) {
      let searchTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          searchQuery = searchInput.value.trim();
          currentPage = 0;
          render();
        }, 350);
      });
    }

    // ─── BOTÓN LIMPIAR ───────────────────────────────────────────────────────
    document.querySelector(SEL.clearBtn)?.addEventListener('click', e => {
      e.preventDefault();
      activeRefinements.operationType.clear();
      activeRefinements.city.clear();
      activeRefinements.propertyType.clear();
      searchQuery = '';
      currentPage = 0;
      if (searchInput) searchInput.value = '';
      document.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => cb.checked = false);
      render();
    });

    // ─── BÚSQUEDA INICIAL ────────────────────────────────────────────────────
    await render();

    console.log('[LCB Algolia] ✓ Inicializado — Finsweet reemplazado');
  }

  // ─── ARRANQUE ───────────────────────────────────────────────────────────────
  // Esperar a que Webflow termine de renderizar el CMS antes de capturar el template
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initAlgolia, 100));
  } else {
    setTimeout(initAlgolia, 100);
  }

})();
