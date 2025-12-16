// ux-utils.js — Utilitaires UX Polish
// États de chargement, messages d'erreur, confirmations, empty states

(function () {
  "use strict";

  // ============================================
  // LOADING STATES
  // ============================================

  /**
   * Affiche un skeleton loader dans un container
   */
  function showSkeleton(container, type = "list", count = 3) {
    if (typeof container === "string") {
      container = document.querySelector(container);
    }
    if (!container) return;

    let html = "";

    switch (type) {
      case "list":
        for (let i = 0; i < count; i++) {
          html += `
            <div class="skeleton-item">
              <div class="skeleton skeleton-avatar"></div>
              <div class="skeleton-content">
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-text"></div>
              </div>
              <div class="skeleton skeleton-action"></div>
            </div>
          `;
        }
        break;
      
      case "card":
        for (let i = 0; i < count; i++) {
          html += `
            <div class="skeleton-card">
              <div class="skeleton skeleton-card-header"></div>
              <div class="skeleton skeleton-card-body"></div>
              <div class="skeleton skeleton-card-footer"></div>
            </div>
          `;
        }
        break;
      
      case "table":
        html = `
          <div class="skeleton-table">
            <div class="skeleton skeleton-table-header"></div>
            ${Array(count).fill().map(() => `
              <div class="skeleton-table-row">
                <div class="skeleton skeleton-cell"></div>
                <div class="skeleton skeleton-cell"></div>
                <div class="skeleton skeleton-cell"></div>
              </div>
            `).join('')}
          </div>
        `;
        break;
      
      case "stats":
        html = `
          <div class="skeleton-stats">
            ${Array(4).fill().map(() => `
              <div class="skeleton-stat">
                <div class="skeleton skeleton-stat-value"></div>
                <div class="skeleton skeleton-stat-label"></div>
              </div>
            `).join('')}
          </div>
        `;
        break;
    }

    container.innerHTML = `<div class="skeleton-container">${html}</div>`;
  }

  /**
   * Affiche un spinner de chargement
   */
  function showSpinner(container, message = "Chargement...") {
    if (typeof container === "string") {
      container = document.querySelector(container);
    }
    if (!container) return;

    container.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <span class="spinner-message">${escapeHtml(message)}</span>
      </div>
    `;
  }

  /**
   * Affiche un spinner inline sur un bouton
   */
  function setButtonLoading(button, loading = true, originalText = null) {
    if (typeof button === "string") {
      button = document.querySelector(button);
    }
    if (!button) return;

    if (loading) {
      button.dataset.originalText = button.innerHTML;
      button.innerHTML = `<span class="btn-spinner"></span> Chargement...`;
      button.disabled = true;
      button.classList.add("loading");
    } else {
      button.innerHTML = originalText || button.dataset.originalText || "OK";
      button.disabled = false;
      button.classList.remove("loading");
    }
  }

  // ============================================
  // EMPTY STATES
  // ============================================

  /**
   * Affiche un état vide avec action suggérée
   */
  function showEmptyState(container, options = {}) {
    if (typeof container === "string") {
      container = document.querySelector(container);
    }
    if (!container) return;

    const {
      icon = "📭",
      title = "Aucun élément",
      description = "Il n'y a rien à afficher pour le moment.",
      actionLabel = null,
      actionCallback = null,
      helpText = null,
    } = options;

    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon}</div>
        <h3 class="empty-title">${escapeHtml(title)}</h3>
        <p class="empty-description">${escapeHtml(description)}</p>
        ${actionLabel ? `
          <button class="btn btn-primary empty-action" id="empty-state-action">
            ${escapeHtml(actionLabel)}
          </button>
        ` : ''}
        ${helpText ? `<p class="empty-help">${escapeHtml(helpText)}</p>` : ''}
      </div>
    `;

    if (actionCallback) {
      const actionBtn = container.querySelector("#empty-state-action");
      if (actionBtn) actionBtn.onclick = actionCallback;
    }
  }

  // Empty states prédéfinis
  const EMPTY_STATES = {
    products: {
      icon: "📦",
      title: "Aucun produit configuré",
      description: "Commencez par ajouter votre premier produit pour suivre son stock.",
      actionLabel: "➕ Ajouter un produit",
    },
    movements: {
      icon: "📋",
      title: "Aucun mouvement de stock",
      description: "Les mouvements apparaîtront ici après votre première vente ou réapprovisionnement.",
    },
    analytics: {
      icon: "📊",
      title: "Pas encore de données",
      description: "Les statistiques s'afficheront après vos premières ventes.",
    },
    suppliers: {
      icon: "🏭",
      title: "Aucun fournisseur",
      description: "Ajoutez vos fournisseurs pour gérer vos achats et comparer les prix.",
      actionLabel: "➕ Ajouter un fournisseur",
    },
    batches: {
      icon: "📦",
      title: "Aucun lot enregistré",
      description: "Les lots permettent de suivre la traçabilité et les dates de péremption.",
    },
    orders: {
      icon: "📝",
      title: "Aucune commande fournisseur",
      description: "Créez des bons de commande pour gérer vos réapprovisionnements.",
      actionLabel: "➕ Nouvelle commande",
    },
    search: {
      icon: "🔍",
      title: "Aucun résultat",
      description: "Essayez avec d'autres termes de recherche.",
    },
  };

  function showPredefinedEmptyState(container, type, actionCallback = null) {
    const config = EMPTY_STATES[type] || EMPTY_STATES.products;
    showEmptyState(container, { ...config, actionCallback });
  }

  // ============================================
  // ERROR MESSAGES
  // ============================================

  const ERROR_MESSAGES = {
    // Erreurs réseau
    network: "Impossible de contacter le serveur. Vérifiez votre connexion internet.",
    timeout: "La requête a pris trop de temps. Veuillez réessayer.",
    
    // Erreurs Shopify
    shopify_auth: "Session Shopify expirée. Veuillez rafraîchir la page.",
    shopify_permission: "Permission Shopify insuffisante. Vérifiez les accès de l'application.",
    shopify_rate_limit: "Trop de requêtes. Veuillez patienter quelques secondes.",
    
    // Erreurs métier
    stock_negative: "Le stock ne peut pas être négatif.",
    product_not_found: "Ce produit n'existe plus. Il a peut-être été supprimé de Shopify.",
    duplicate_product: "Ce produit est déjà configuré dans l'application.",
    
    // Erreurs plan
    plan_limit: "Vous avez atteint la limite de votre plan.",
    feature_locked: "Cette fonctionnalité nécessite un plan supérieur.",
    
    // Erreurs génériques
    unknown: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    validation: "Veuillez vérifier les informations saisies.",
  };

  /**
   * Traduit un code d'erreur en message compréhensible
   */
  function getErrorMessage(error) {
    if (typeof error === "string") {
      return ERROR_MESSAGES[error] || error;
    }
    
    if (error?.code) {
      return ERROR_MESSAGES[error.code] || error.message || ERROR_MESSAGES.unknown;
    }
    
    if (error?.message) {
      // Traduire les messages techniques
      const msg = error.message.toLowerCase();
      if (msg.includes("network") || msg.includes("fetch")) return ERROR_MESSAGES.network;
      if (msg.includes("timeout")) return ERROR_MESSAGES.timeout;
      if (msg.includes("401") || msg.includes("unauthorized")) return ERROR_MESSAGES.shopify_auth;
      if (msg.includes("403") || msg.includes("forbidden")) return ERROR_MESSAGES.shopify_permission;
      if (msg.includes("429")) return ERROR_MESSAGES.shopify_rate_limit;
      return error.message;
    }
    
    return ERROR_MESSAGES.unknown;
  }

  /**
   * Affiche une erreur dans un container
   */
  function showError(container, error, options = {}) {
    if (typeof container === "string") {
      container = document.querySelector(container);
    }
    if (!container) return;

    const {
      retryCallback = null,
      dismissible = true,
    } = options;

    const message = getErrorMessage(error);

    container.innerHTML = `
      <div class="error-state ${dismissible ? 'dismissible' : ''}">
        <div class="error-icon">⚠️</div>
        <div class="error-content">
          <p class="error-message">${escapeHtml(message)}</p>
          <div class="error-actions">
            ${retryCallback ? `
              <button class="btn btn-outline btn-sm error-retry">
                🔄 Réessayer
              </button>
            ` : ''}
            ${dismissible ? `
              <button class="btn btn-ghost btn-sm error-dismiss">
                Fermer
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    if (retryCallback) {
      const retryBtn = container.querySelector(".error-retry");
      if (retryBtn) retryBtn.onclick = retryCallback;
    }

    if (dismissible) {
      const dismissBtn = container.querySelector(".error-dismiss");
      if (dismissBtn) dismissBtn.onclick = () => container.innerHTML = "";
    }
  }

  // ============================================
  // TOAST NOTIFICATIONS
  // ============================================

  const toastQueue = [];
  let toastContainer = null;

  function getToastContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement("div");
      toastContainer.id = "toast-container";
      toastContainer.className = "toast-container";
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  /**
   * Affiche un toast notification
   */
  function showToast(message, type = "info", options = {}) {
    const {
      duration = 4000,
      action = null,
      actionLabel = null,
    } = options;

    const container = getToastContainer();
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    const icons = {
      success: "✅",
      error: "❌",
      warning: "⚠️",
      info: "ℹ️",
    };

    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      ${action && actionLabel ? `
        <button class="toast-action">${escapeHtml(actionLabel)}</button>
      ` : ''}
      <button class="toast-close">×</button>
    `;

    container.appendChild(toast);

    // Animation d'entrée
    requestAnimationFrame(() => toast.classList.add("visible"));

    // Action button
    if (action) {
      const actionBtn = toast.querySelector(".toast-action");
      if (actionBtn) actionBtn.onclick = () => {
        action();
        removeToast(toast);
      };
    }

    // Close button
    toast.querySelector(".toast-close").onclick = () => removeToast(toast);

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }

    return toast;
  }

  function removeToast(toast) {
    toast.classList.remove("visible");
    toast.classList.add("hiding");
    setTimeout(() => toast.remove(), 300);
  }

  // ============================================
  // CONFIRMATION DIALOGS
  // ============================================

  /**
   * Affiche une modale de confirmation
   */
  function confirm(options = {}) {
    return new Promise((resolve) => {
      const {
        title = "Confirmation",
        message = "Êtes-vous sûr ?",
        confirmLabel = "Confirmer",
        cancelLabel = "Annuler",
        type = "warning", // warning, danger, info
        icon = null,
      } = options;

      const icons = {
        warning: "⚠️",
        danger: "🗑️",
        info: "ℹ️",
      };

      const modal = document.createElement("div");
      modal.className = "confirm-modal";
      modal.innerHTML = `
        <div class="confirm-backdrop"></div>
        <div class="confirm-dialog ${type}">
          <div class="confirm-icon">${icon || icons[type] || icons.warning}</div>
          <h3 class="confirm-title">${escapeHtml(title)}</h3>
          <p class="confirm-message">${escapeHtml(message)}</p>
          <div class="confirm-actions">
            <button class="btn btn-outline confirm-cancel">
              ${escapeHtml(cancelLabel)}
            </button>
            <button class="btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'} confirm-ok">
              ${escapeHtml(confirmLabel)}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      requestAnimationFrame(() => modal.classList.add("visible"));

      const close = (result) => {
        modal.classList.remove("visible");
        setTimeout(() => modal.remove(), 300);
        resolve(result);
      };

      modal.querySelector(".confirm-backdrop").onclick = () => close(false);
      modal.querySelector(".confirm-cancel").onclick = () => close(false);
      modal.querySelector(".confirm-ok").onclick = () => close(true);

      // Focus sur le bouton annuler (plus sûr)
      modal.querySelector(".confirm-cancel").focus();
    });
  }

  /**
   * Confirmation avant action destructrice
   */
  async function confirmDestructive(options = {}) {
    return confirm({
      type: "danger",
      title: options.title || "Action irréversible",
      message: options.message || "Cette action ne peut pas être annulée. Continuer ?",
      confirmLabel: options.confirmLabel || "Supprimer",
      ...options,
    });
  }

  // ============================================
  // TOOLTIPS
  // ============================================

  function initTooltips() {
    document.addEventListener("mouseenter", (e) => {
      const target = e.target.closest("[data-tooltip]");
      if (!target) return;

      const text = target.dataset.tooltip;
      if (!text) return;

      showTooltip(target, text);
    }, true);

    document.addEventListener("mouseleave", (e) => {
      const target = e.target.closest("[data-tooltip]");
      if (target) hideTooltip();
    }, true);
  }

  let activeTooltip = null;

  function showTooltip(element, text) {
    hideTooltip();

    const rect = element.getBoundingClientRect();
    const tooltip = document.createElement("div");
    tooltip.className = "tooltip";
    tooltip.textContent = text;
    document.body.appendChild(tooltip);

    // Positionner
    const tooltipRect = tooltip.getBoundingClientRect();
    let top = rect.top - tooltipRect.height - 8;
    let left = rect.left + (rect.width - tooltipRect.width) / 2;

    // Ajuster si déborde
    if (top < 8) top = rect.bottom + 8;
    if (left < 8) left = 8;
    if (left + tooltipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tooltipRect.width - 8;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    requestAnimationFrame(() => tooltip.classList.add("visible"));
    activeTooltip = tooltip;
  }

  function hideTooltip() {
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
  }

  // ============================================
  // FORM VALIDATION
  // ============================================

  /**
   * Valide un formulaire et affiche les erreurs
   */
  function validateForm(form, rules) {
    if (typeof form === "string") {
      form = document.querySelector(form);
    }
    if (!form) return { valid: false, errors: ["Formulaire non trouvé"] };

    const errors = [];
    const data = {};

    // Supprimer les erreurs précédentes
    form.querySelectorAll(".field-error").forEach(el => el.remove());
    form.querySelectorAll(".has-error").forEach(el => el.classList.remove("has-error"));

    for (const [fieldName, fieldRules] of Object.entries(rules)) {
      const input = form.querySelector(`[name="${fieldName}"]`);
      if (!input) continue;

      const value = input.value.trim();
      data[fieldName] = value;

      for (const rule of fieldRules) {
        let error = null;

        if (rule.required && !value) {
          error = rule.message || "Ce champ est requis";
        } else if (rule.min !== undefined && Number(value) < rule.min) {
          error = rule.message || `Minimum : ${rule.min}`;
        } else if (rule.max !== undefined && Number(value) > rule.max) {
          error = rule.message || `Maximum : ${rule.max}`;
        } else if (rule.pattern && !rule.pattern.test(value)) {
          error = rule.message || "Format invalide";
        } else if (rule.custom && !rule.custom(value)) {
          error = rule.message || "Valeur invalide";
        }

        if (error) {
          errors.push({ field: fieldName, message: error });
          showFieldError(input, error);
          break;
        }
      }
    }

    return { valid: errors.length === 0, errors, data };
  }

  function showFieldError(input, message) {
    const wrapper = input.closest(".field") || input.parentElement;
    wrapper.classList.add("has-error");

    const errorEl = document.createElement("span");
    errorEl.className = "field-error";
    errorEl.textContent = message;
    wrapper.appendChild(errorEl);
  }

  // ============================================
  // HELPERS
  // ============================================

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================
  // INIT
  // ============================================

  function init() {
    initTooltips();
  }

  // ============================================
  // EXPORTS
  // ============================================

  window.ux = {
    // Loading
    showSkeleton,
    showSpinner,
    setButtonLoading,
    
    // Empty states
    showEmptyState,
    showPredefinedEmptyState,
    EMPTY_STATES,
    
    // Errors
    getErrorMessage,
    showError,
    ERROR_MESSAGES,
    
    // Toast
    showToast,
    
    // Confirm
    confirm,
    confirmDestructive,
    
    // Tooltip
    showTooltip,
    hideTooltip,
    
    // Form
    validateForm,
    showFieldError,
    
    // Init
    init,
  };

  // Alias global pour showToast
  window.showToast = showToast;

  // Auto-init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
