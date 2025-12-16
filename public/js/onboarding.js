// onboarding.js — Système d'onboarding guidé
// Parcours utilisateur première utilisation + checklist progression

(function () {
  "use strict";

  // ============================================
  // CONFIGURATION ONBOARDING
  // ============================================

  const ONBOARDING_STEPS = [
    {
      id: "welcome",
      title: "Bienvenue sur Stock Manager ! 👋",
      subtitle: "Gérez votre stock au gramme près, automatiquement.",
      description: "En 3 minutes, vous allez configurer votre premier produit et activer la synchronisation automatique avec Shopify.",
      icon: "🚀",
      action: null,
      skipable: false,
    },
    {
      id: "add_product",
      title: "Étape 1 : Ajoutez votre premier produit",
      subtitle: "Importez depuis Shopify ou créez manuellement",
      description: "Sélectionnez un produit vendu au poids (CBD, thé, café...) pour commencer à suivre son stock.",
      icon: "📦",
      action: "showAddProductModal",
      highlight: "[data-action='add-product'], .btn-add-product",
      completion: "hasProducts",
    },
    {
      id: "set_stock",
      title: "Étape 2 : Définissez votre stock initial",
      subtitle: "Combien de grammes avez-vous en stock ?",
      description: "Entrez la quantité totale disponible. Ce sera votre point de départ.",
      icon: "⚖️",
      action: "showRestockModal",
      highlight: "[data-action='restock']",
      completion: "hasStock",
    },
    {
      id: "set_cost",
      title: "Étape 3 : Renseignez votre coût d'achat",
      subtitle: "Pour calculer vos marges automatiquement",
      description: "Indiquez le prix d'achat par gramme. Vos marges seront calculées à chaque vente.",
      icon: "💰",
      action: "showCostModal",
      highlight: "[data-action='set-cost']",
      completion: "hasCost",
      optional: true,
    },
    {
      id: "enable_sync",
      title: "Étape 4 : Activez la synchronisation",
      subtitle: "Vos ventes Shopify déduiront le stock automatiquement",
      description: "Une fois activé, chaque commande mettra à jour votre stock en temps réel.",
      icon: "🔄",
      action: "enableSync",
      highlight: "[data-action='sync-toggle']",
      completion: "syncEnabled",
    },
    {
      id: "complete",
      title: "🎉 Félicitations !",
      subtitle: "Votre stock est maintenant géré automatiquement",
      description: "Vous pouvez ajouter d'autres produits, configurer des alertes de stock bas, et explorer les statistiques.",
      icon: "✅",
      action: null,
      cta: "Explorer l'application",
    },
  ];

  const STORAGE_KEY = "stockmanager_onboarding";

  // ============================================
  // STATE
  // ============================================

  const onboardingState = {
    currentStep: 0,
    completed: false,
    skipped: false,
    progress: {},
    shown: false,
  };

  // ============================================
  // PERSISTENCE
  // ============================================

  function loadOnboardingState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        Object.assign(onboardingState, data);
      }
    } catch (e) {
      console.warn("Erreur chargement onboarding:", e);
    }
  }

  function saveOnboardingState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(onboardingState));
    } catch (e) {
      console.warn("Erreur sauvegarde onboarding:", e);
    }
  }

  function resetOnboarding() {
    onboardingState.currentStep = 0;
    onboardingState.completed = false;
    onboardingState.skipped = false;
    onboardingState.progress = {};
    saveOnboardingState();
  }

  // ============================================
  // COMPLETION CHECKS
  // ============================================

  function checkCompletion(checkType) {
    switch (checkType) {
      case "hasProducts":
        return window.appState?.products?.length > 0;
      case "hasStock":
        return window.appState?.products?.some(p => p.totalGrams > 0);
      case "hasCost":
        return window.appState?.products?.some(p => p.averageCostPerGram > 0);
      case "syncEnabled":
        return window.appState?.syncEnabled !== false;
      default:
        return false;
    }
  }

  function updateProgress() {
    ONBOARDING_STEPS.forEach((step, index) => {
      if (step.completion) {
        onboardingState.progress[step.id] = checkCompletion(step.completion);
      }
    });
    saveOnboardingState();
  }

  // ============================================
  // MODAL RENDERING
  // ============================================

  function createOnboardingModal() {
    // Supprimer si existe déjà
    const existing = document.getElementById("onboarding-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "onboarding-modal";
    modal.className = "onboarding-modal";
    modal.innerHTML = `
      <div class="onboarding-backdrop"></div>
      <div class="onboarding-container">
        <div class="onboarding-progress">
          ${ONBOARDING_STEPS.map((step, i) => `
            <div class="progress-step ${i < onboardingState.currentStep ? 'completed' : ''} ${i === onboardingState.currentStep ? 'active' : ''}" data-step="${i}">
              <div class="progress-dot">${i < onboardingState.currentStep ? '✓' : i + 1}</div>
              ${i < ONBOARDING_STEPS.length - 1 ? '<div class="progress-line"></div>' : ''}
            </div>
          `).join('')}
        </div>
        
        <div class="onboarding-content" id="onboarding-content">
          <!-- Contenu dynamique -->
        </div>
        
        <div class="onboarding-footer">
          <button class="btn btn-ghost" id="onboarding-skip">
            Passer l'introduction
          </button>
          <div class="onboarding-actions">
            <button class="btn btn-outline" id="onboarding-prev" style="display: none;">
              ← Précédent
            </button>
            <button class="btn btn-primary" id="onboarding-next">
              Suivant →
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector(".onboarding-backdrop").onclick = () => {
      if (onboardingState.currentStep > 0) hideOnboarding();
    };
    modal.querySelector("#onboarding-skip").onclick = skipOnboarding;
    modal.querySelector("#onboarding-prev").onclick = prevStep;
    modal.querySelector("#onboarding-next").onclick = nextStep;

    return modal;
  }

  function renderCurrentStep() {
    const step = ONBOARDING_STEPS[onboardingState.currentStep];
    if (!step) return;

    const content = document.getElementById("onboarding-content");
    if (!content) return;

    const isLastStep = onboardingState.currentStep === ONBOARDING_STEPS.length - 1;
    const isFirstStep = onboardingState.currentStep === 0;

    content.innerHTML = `
      <div class="onboarding-step">
        <div class="step-icon">${step.icon}</div>
        <h2 class="step-title">${step.title}</h2>
        <p class="step-subtitle">${step.subtitle}</p>
        <p class="step-description">${step.description}</p>
        
        ${step.id === "welcome" ? renderWelcomeExtras() : ""}
        ${step.id === "complete" ? renderCompleteExtras() : ""}
        
        ${step.completion && onboardingState.progress[step.id] ? `
          <div class="step-completed">
            <span class="completed-badge">✅ Complété !</span>
          </div>
        ` : ""}
      </div>
    `;

    // Update buttons
    const prevBtn = document.getElementById("onboarding-prev");
    const nextBtn = document.getElementById("onboarding-next");
    const skipBtn = document.getElementById("onboarding-skip");

    if (prevBtn) prevBtn.style.display = isFirstStep ? "none" : "inline-flex";
    if (skipBtn) skipBtn.style.display = isLastStep ? "none" : "inline-flex";
    
    if (nextBtn) {
      if (isLastStep) {
        nextBtn.textContent = step.cta || "Terminer";
        nextBtn.onclick = completeOnboarding;
      } else if (step.action) {
        nextBtn.textContent = "C'est parti ! →";
        nextBtn.onclick = () => executeStepAction(step);
      } else {
        nextBtn.textContent = "Suivant →";
        nextBtn.onclick = nextStep;
      }
    }

    // Update progress dots
    document.querySelectorAll(".progress-step").forEach((dot, i) => {
      dot.classList.toggle("completed", i < onboardingState.currentStep);
      dot.classList.toggle("active", i === onboardingState.currentStep);
    });

    // Highlight element if specified
    if (step.highlight) {
      highlightElement(step.highlight);
    } else {
      removeHighlight();
    }
  }

  function renderWelcomeExtras() {
    return `
      <div class="welcome-features">
        <div class="feature-item">
          <span class="feature-icon">📦</span>
          <span>Stock au gramme près</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">🔄</span>
          <span>Synchronisation automatique</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">📊</span>
          <span>Marges en temps réel</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">⚠️</span>
          <span>Alertes stock bas</span>
        </div>
      </div>
      <div class="welcome-time">
        <span class="time-icon">⏱️</span>
        <span>Temps estimé : <strong>3 minutes</strong></span>
      </div>
    `;
  }

  function renderCompleteExtras() {
    return `
      <div class="complete-checklist">
        <h4>Prochaines étapes suggérées :</h4>
        <div class="checklist-item">
          <span class="check-icon">📦</span>
          <span>Ajouter d'autres produits</span>
        </div>
        <div class="checklist-item">
          <span class="check-icon">🏷️</span>
          <span>Organiser par catégories</span>
        </div>
        <div class="checklist-item">
          <span class="check-icon">⚠️</span>
          <span>Configurer les alertes de stock bas</span>
        </div>
        <div class="checklist-item">
          <span class="check-icon">📊</span>
          <span>Explorer les statistiques</span>
        </div>
      </div>
    `;
  }

  // ============================================
  // HIGHLIGHTING
  // ============================================

  function highlightElement(selector) {
    removeHighlight();
    
    const element = document.querySelector(selector);
    if (!element) return;

    // Créer overlay
    const overlay = document.createElement("div");
    overlay.id = "onboarding-highlight-overlay";
    overlay.className = "highlight-overlay";
    document.body.appendChild(overlay);

    // Créer spotlight
    const rect = element.getBoundingClientRect();
    const spotlight = document.createElement("div");
    spotlight.id = "onboarding-spotlight";
    spotlight.className = "highlight-spotlight";
    spotlight.style.cssText = `
      top: ${rect.top - 8}px;
      left: ${rect.left - 8}px;
      width: ${rect.width + 16}px;
      height: ${rect.height + 16}px;
    `;
    document.body.appendChild(spotlight);

    // Ajouter classe à l'élément
    element.classList.add("onboarding-highlighted");
  }

  function removeHighlight() {
    document.getElementById("onboarding-highlight-overlay")?.remove();
    document.getElementById("onboarding-spotlight")?.remove();
    document.querySelectorAll(".onboarding-highlighted").forEach(el => {
      el.classList.remove("onboarding-highlighted");
    });
  }

  // ============================================
  // NAVIGATION
  // ============================================

  function nextStep() {
    if (onboardingState.currentStep < ONBOARDING_STEPS.length - 1) {
      onboardingState.currentStep++;
      saveOnboardingState();
      renderCurrentStep();
    }
  }

  function prevStep() {
    if (onboardingState.currentStep > 0) {
      onboardingState.currentStep--;
      saveOnboardingState();
      renderCurrentStep();
    }
  }

  function goToStep(stepIndex) {
    if (stepIndex >= 0 && stepIndex < ONBOARDING_STEPS.length) {
      onboardingState.currentStep = stepIndex;
      saveOnboardingState();
      renderCurrentStep();
    }
  }

  function executeStepAction(step) {
    hideOnboarding();
    
    // Exécuter l'action
    switch (step.action) {
      case "showAddProductModal":
        if (window.showAddProductModal) window.showAddProductModal();
        else if (window.app?.showAddProductModal) window.app.showAddProductModal();
        break;
      case "showRestockModal":
        // Trouver le premier produit et ouvrir restock
        const firstProduct = window.appState?.products?.[0];
        if (firstProduct && window.showRestockModal) {
          window.showRestockModal(firstProduct.id);
        }
        break;
      case "showCostModal":
        const product = window.appState?.products?.[0];
        if (product && window.showCostModal) {
          window.showCostModal(product.id);
        }
        break;
      case "enableSync":
        if (window.toggleSync) window.toggleSync(true);
        break;
    }

    // Écouter la complétion
    setTimeout(() => {
      updateProgress();
      if (step.completion && checkCompletion(step.completion)) {
        showOnboarding();
        nextStep();
      }
    }, 500);
  }

  function skipOnboarding() {
    onboardingState.skipped = true;
    onboardingState.completed = true;
    saveOnboardingState();
    hideOnboarding();
    removeHighlight();
    showToast("Vous pouvez reprendre l'introduction depuis les paramètres", "info");
  }

  function completeOnboarding() {
    onboardingState.completed = true;
    saveOnboardingState();
    hideOnboarding();
    removeHighlight();
    showToast("🎉 Configuration terminée !", "success");
  }

  // ============================================
  // SHOW / HIDE
  // ============================================

  function showOnboarding() {
    if (onboardingState.shown) return;
    
    const modal = createOnboardingModal();
    renderCurrentStep();
    
    requestAnimationFrame(() => {
      modal.classList.add("visible");
    });
    
    onboardingState.shown = true;
  }

  function hideOnboarding() {
    const modal = document.getElementById("onboarding-modal");
    if (modal) {
      modal.classList.remove("visible");
      setTimeout(() => modal.remove(), 300);
    }
    onboardingState.shown = false;
  }

  // ============================================
  // CHECKLIST WIDGET (persistent)
  // ============================================

  function createChecklistWidget() {
    const existing = document.getElementById("onboarding-checklist");
    if (existing) existing.remove();

    if (onboardingState.completed) return;

    const completedCount = Object.values(onboardingState.progress).filter(Boolean).length;
    const totalCount = ONBOARDING_STEPS.filter(s => s.completion).length;

    if (completedCount >= totalCount) return;

    const widget = document.createElement("div");
    widget.id = "onboarding-checklist";
    widget.className = "checklist-widget";
    widget.innerHTML = `
      <div class="checklist-header" onclick="onboarding.toggleChecklist()">
        <span class="checklist-icon">📋</span>
        <span class="checklist-title">Configuration</span>
        <span class="checklist-progress">${completedCount}/${totalCount}</span>
        <span class="checklist-toggle">▼</span>
      </div>
      <div class="checklist-body">
        ${ONBOARDING_STEPS.filter(s => s.completion).map(step => `
          <div class="checklist-task ${onboardingState.progress[step.id] ? 'completed' : ''}">
            <span class="task-check">${onboardingState.progress[step.id] ? '✅' : '○'}</span>
            <span class="task-label">${step.subtitle}</span>
          </div>
        `).join('')}
        <button class="btn btn-sm btn-primary checklist-resume" onclick="onboarding.resume()">
          Reprendre la configuration
        </button>
      </div>
    `;

    document.body.appendChild(widget);
  }

  function toggleChecklist() {
    const widget = document.getElementById("onboarding-checklist");
    if (widget) {
      widget.classList.toggle("expanded");
    }
  }

  function resume() {
    // Trouver la première étape non complétée
    for (let i = 0; i < ONBOARDING_STEPS.length; i++) {
      const step = ONBOARDING_STEPS[i];
      if (step.completion && !onboardingState.progress[step.id]) {
        onboardingState.currentStep = i;
        break;
      }
    }
    saveOnboardingState();
    showOnboarding();
  }

  // ============================================
  // TOAST
  // ============================================

  function showToast(message, type = "info") {
    if (window.showToast) {
      window.showToast(message, type);
      return;
    }
    
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; padding: 16px 24px;
      background: ${type === "error" ? "#ef4444" : type === "success" ? "#10b981" : "#3b82f6"};
      color: white; border-radius: 12px; font-weight: 500; z-index: 10000;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      animation: slideInUp 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = "slideOutDown 0.3s ease forwards";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ============================================
  // INIT
  // ============================================

  function init() {
    loadOnboardingState();
    
    // Si pas encore complété et pas skippé, montrer après un délai
    if (!onboardingState.completed && !onboardingState.skipped) {
      setTimeout(() => {
        showOnboarding();
      }, 1000);
    } else if (!onboardingState.completed) {
      // Montrer la checklist si pas complété
      setTimeout(() => {
        updateProgress();
        createChecklistWidget();
      }, 1500);
    }

    // Écouter les changements pour mettre à jour la checklist
    setInterval(() => {
      if (!onboardingState.completed) {
        updateProgress();
        createChecklistWidget();
      }
    }, 5000);
  }

  // ============================================
  // EXPORTS
  // ============================================

  window.onboarding = {
    init,
    show: showOnboarding,
    hide: hideOnboarding,
    reset: resetOnboarding,
    resume,
    toggleChecklist,
    goToStep,
    updateProgress,
  };

  // Auto-init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 500);
  }

})();
