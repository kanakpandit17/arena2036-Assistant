document.addEventListener("DOMContentLoaded", () => {
    // Element selections
    const searchInput = document.getElementById("searchInput");
    const searchButton = document.getElementById("searchButton");
    const heroSection = document.getElementById("heroSection");
    const answerSection = document.getElementById("answerSection");
    const backButton = document.getElementById("backButton");
    const questionDisplay = document.getElementById("questionDisplay");
    const loadingState = document.getElementById("loadingState");
    const answerContent = document.getElementById("answerContent");
    const sourcesSection = document.getElementById("sourcesSection");
    const sourcesList = document.getElementById("sourcesList");
    const feedbackSection = document.getElementById("feedbackSection");
    const relatedQuestionsSection = document.getElementById("relatedQuestionsSection");
    const relatedQuestionsList = document.getElementById("relatedQuestionsList");
    const quickHelpContainer = document.getElementById("quickHelpContainer");
    const quickHelpLoading = document.getElementById("quickHelpLoading");

    // State variables
    let suggestionTimeout;
    let currentSuggestions = [];
    let selectedSuggestionIndex = -1;
    let suggestionsVisible = false;
    let virtualList = null;

    // Configure marked
    marked.setOptions({
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true,
        gfm: true
    });

    // IndexedDB Cache Manager
    class SuggestionCache {
        constructor() {
            this.dbName = 'Arena2036SuggestionsDB';
            this.dbVersion = 1;
            this.storeName = 'suggestions';
            this.db = null;
            this.memoryCache = new Map();
            this.maxMemorySize = 500;
            this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
            this.init();
        }

        async init() {
            try {
                this.db = await this.openDB();
                console.log('IndexedDB initialized successfully');
            } catch (error) {
                console.warn('IndexedDB failed to initialize:', error);
            }
        }

        openDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        const store = db.createObjectStore(this.storeName, { keyPath: 'query' });
                        store.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                };
            });
        }

        async get(query) {
            const cacheKey = query.toLowerCase().trim();
            
            // Check memory cache first
            if (this.memoryCache.has(cacheKey)) {
                const cached = this.memoryCache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.cacheExpiry) {
                    return cached.suggestions;
                } else {
                    this.memoryCache.delete(cacheKey);
                }
            }

            // Check IndexedDB
            if (!this.db) return null;

            try {
                const transaction = this.db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                
                return new Promise((resolve) => {
                    const request = store.get(cacheKey);
                    
                    request.onsuccess = () => {
                        const result = request.result;
                        if (result && (Date.now() - result.timestamp) < this.cacheExpiry) {
                            // Update memory cache
                            this.memoryCache.set(cacheKey, {
                                suggestions: result.suggestions,
                                timestamp: result.timestamp
                            });
                            resolve(result.suggestions);
                        } else {
                            resolve(null);
                        }
                    };
                    
                    request.onerror = () => resolve(null);
                });
            } catch (error) {
                console.warn('Cache get error:', error);
                return null;
            }
        }

        async set(query, suggestions) {
            const cacheKey = query.toLowerCase().trim();
            const timestamp = Date.now();
            const cacheData = { suggestions, timestamp };

            // Update memory cache
            this.memoryCache.set(cacheKey, cacheData);
            
            // Limit memory cache size
            if (this.memoryCache.size > this.maxMemorySize) {
                const firstKey = this.memoryCache.keys().next().value;
                this.memoryCache.delete(firstKey);
            }

            // Update IndexedDB
            if (!this.db) return;

            try {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                
                store.put({
                    query: cacheKey,
                    suggestions,
                    timestamp
                });
            } catch (error) {
                console.warn('Cache set error:', error);
            }
        }

        async clear() {
            this.memoryCache.clear();
            if (!this.db) return;

            try {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                store.clear();
            } catch (error) {
                console.warn('Cache clear error:', error);
            }
        }
    }

    // Virtual Scrolling Implementation
    class VirtualSuggestionsList {
        constructor(container) {
            this.container = container;
            this.itemHeight = 44;
            this.visibleCount = Math.min(8, Math.floor(300 / this.itemHeight)); // Max 300px height
            this.scrollTop = 0;
            this.data = [];
            this.selectedIndex = -1;
        }

        render(suggestions, selectedIndex = -1) {
            this.data = suggestions;
            this.selectedIndex = selectedIndex;
            
            if (suggestions.length === 0) {
                this.container.innerHTML = '<div class="no-suggestions">No suggestions found</div>';
                return;
            }

            // Use virtual scrolling only for large lists
            if (suggestions.length <= 10) {
                this.renderDirect(suggestions, selectedIndex);
                return;
            }

            const totalHeight = suggestions.length * this.itemHeight;
            const startIndex = Math.floor(this.scrollTop / this.itemHeight);
            const endIndex = Math.min(startIndex + this.visibleCount + 2, suggestions.length); // +2 for buffer
            
            const visibleItems = suggestions.slice(startIndex, endIndex);
            
            this.container.innerHTML = `
                <div class="virtual-container" style="height: ${totalHeight}px; position: relative;">
                    <div class="virtual-content" style="transform: translateY(${startIndex * this.itemHeight}px);">
                        ${visibleItems.map((suggestion, index) => {
                            const actualIndex = startIndex + index;
                            const isSelected = actualIndex === selectedIndex;
                            return `<div class="suggestion-item ${isSelected ? 'selected' : ''}" 
                                         data-index="${actualIndex}" 
                                         style="height: ${this.itemHeight}px; line-height: ${this.itemHeight}px;">
                                        <span class="suggestion-icon">🔍</span>
                                        <span class="suggestion-text">${this.highlightMatch(suggestion, searchInput.value)}</span>
                                    </div>`;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        renderDirect(suggestions, selectedIndex = -1) {
            this.container.innerHTML = suggestions.map((suggestion, index) => {
                const isSelected = index === selectedIndex;
                return `<div class="suggestion-item ${isSelected ? 'selected' : ''}" 
                             data-index="${index}">
                            <span class="suggestion-icon">🔍</span>
                            <span class="suggestion-text">${this.highlightMatch(suggestion, searchInput.value)}</span>
                        </div>`;
            }).join('');
        }

        highlightMatch(text, query) {
            if (!query || query.length < 2) return text;
            
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            return text.replace(regex, '<mark>$1</mark>');
        }

        handleScroll(scrollTop) {
            if (this.data.length <= 10) return; // No virtual scrolling for small lists
            
            this.scrollTop = scrollTop;
            this.render(this.data, this.selectedIndex);
        }

        updateSelection(newIndex) {
            this.selectedIndex = newIndex;
            this.render(this.data, newIndex);
            
            // Scroll to keep selected item visible
            if (this.data.length > 10) {
                const itemTop = newIndex * this.itemHeight;
                const itemBottom = itemTop + this.itemHeight;
                const containerTop = this.scrollTop;
                const containerBottom = containerTop + (this.visibleCount * this.itemHeight);
                
                if (itemTop < containerTop) {
                    this.container.scrollTop = itemTop;
                } else if (itemBottom > containerBottom) {
                    this.container.scrollTop = itemBottom - (this.visibleCount * this.itemHeight);
                }
            }
        }
    }

    // Initialize cache
    const cache = new SuggestionCache();

    // Initialize quick help suggestions
    loadQuickHelpSuggestions();

    // Main functions
    async function loadQuickHelpSuggestions() {
        try {
            // Try cache first
            const cachedSuggestions = await cache.get('');
            if (cachedSuggestions && cachedSuggestions.length > 0) {
                renderQuickHelp(cachedSuggestions.slice(0, 5));
                return;
            }

            const response = await fetch('http://localhost:8000/suggestions?limit=5');
            
            if (response.ok) {
                const data = await response.json();
                await cache.set('', data.suggestions);
                renderQuickHelp(data.suggestions);
            } else {
                throw new Error('API request failed');
            }
        } catch (error) {
            console.error("Error loading suggestions:", error);
            renderQuickHelp([
                "How do I connect my domain to Arena2036?",
                "How do I set up Arena2036 Services?",
                "How do I use Arena2036 Projects?",
                "How do I reset my Arena2036 account?",
                "How do I customize my Arena2036 profile?"
            ]);
        }
    }

    function renderQuickHelp(suggestions) {
        quickHelpLoading.style.display = "none";
        
        const helpTagsHTML = suggestions.map(suggestion => 
            `<button class="help-tag" data-question="${suggestion}">${suggestion}</button>`
        ).join('');
        
        quickHelpContainer.innerHTML = helpTagsHTML;
        
        quickHelpContainer.querySelectorAll('.help-tag').forEach(tag => {
            tag.addEventListener("click", () => {
                fetchAnswer(tag.dataset.question);
            });
        });
    }

    async function loadAutocompleteSuggestions(query) {
        if (query.length < 1) {
            hideSuggestions();
            return;
        }

        try {
            // Check cache first
            const cachedSuggestions = await cache.get(query);
            if (cachedSuggestions) {
                showAutocompleteSuggestions(cachedSuggestions);
                return;
            }

            const response = await fetch(`http://localhost:8000/suggestions?q=${encodeURIComponent(query)}&limit=20`);
            
            if (response.ok) {
                const data = await response.json();
                
                // Cache the results
                await cache.set(query, data.suggestions);
                
                showAutocompleteSuggestions(data.suggestions);
            }
        } catch (error) {
            console.error("Error loading autocomplete suggestions:", error);
            hideSuggestions();
        }
    }

    function showAutocompleteSuggestions(suggestions) {
        if (suggestions.length === 0) {
            hideSuggestions();
            return;
        }

        currentSuggestions = suggestions;
        selectedSuggestionIndex = -1;
        
        let suggestionsDropdown = document.getElementById('suggestionsDropdown');
        
        if (!suggestionsDropdown) {
            suggestionsDropdown = document.createElement('div');
            suggestionsDropdown.id = 'suggestionsDropdown';
            suggestionsDropdown.className = 'suggestions-dropdown';
            document.querySelector('.search-wrapper').appendChild(suggestionsDropdown);
            
            // Initialize virtual list
            virtualList = new VirtualSuggestionsList(suggestionsDropdown);
            
            // Add scroll listener for virtual scrolling
            suggestionsDropdown.addEventListener('scroll', (e) => {
                virtualList.handleScroll(e.target.scrollTop);
            });
            
            // Add click listener
            suggestionsDropdown.addEventListener('click', handleSuggestionClick);
        }
        
        virtualList.render(suggestions);
        suggestionsDropdown.style.display = 'block';
        suggestionsVisible = true;
    }

    function hideSuggestions() {
        const suggestionsDropdown = document.getElementById('suggestionsDropdown');
        if (suggestionsDropdown) {
            suggestionsDropdown.style.display = 'none';
        }
        suggestionsVisible = false;
        selectedSuggestionIndex = -1;
    }

    function handleSuggestionClick(e) {
        const item = e.target.closest('.suggestion-item');
        if (item) {
            const index = parseInt(item.dataset.index);
            const suggestion = currentSuggestions[index];
            searchInput.value = suggestion;
            hideSuggestions();
            fetchAnswer(suggestion);
        }
    }

    function handleSuggestionKeyboard(e) {
        if (!suggestionsVisible || currentSuggestions.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, currentSuggestions.length - 1);
            virtualList.updateSelection(selectedSuggestionIndex);
            searchInput.value = currentSuggestions[selectedSuggestionIndex];
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
            if (selectedSuggestionIndex >= 0) {
                virtualList.updateSelection(selectedSuggestionIndex);
                searchInput.value = currentSuggestions[selectedSuggestionIndex];
            } else {
                virtualList.updateSelection(-1);
                searchInput.value = searchInput.dataset.originalValue || '';
            }
        } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
            e.preventDefault();
            const selectedSuggestion = currentSuggestions[selectedSuggestionIndex];
            searchInput.value = selectedSuggestion;
            hideSuggestions();
            fetchAnswer(selectedSuggestion);
        } else if (e.key === 'Escape') {
            hideSuggestions();
            searchInput.value = searchInput.dataset.originalValue || '';
        }
    }

    // Core functionality
    const showAnswerSection = (question) => {
        questionDisplay.textContent = question;
        heroSection.style.display = "none";
        answerSection.style.display = "block";
        
        loadingState.style.display = "flex";
        answerContent.style.display = "none";
        sourcesSection.style.display = "none";
        feedbackSection.style.display = "none";
        relatedQuestionsSection.style.display = "none";
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const showHeroSection = () => {
        heroSection.style.display = "block";
        answerSection.style.display = "none";
        searchInput.value = "";
        searchInput.focus();
    };

    const renderMarkdownAnswer = (markdownText) => {
        const htmlContent = marked.parse(markdownText);
        answerContent.innerHTML = htmlContent;
        
        answerContent.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
        
        loadingState.style.display = "none";
        answerContent.style.display = "block";
        feedbackSection.style.display = "flex";
        relatedQuestionsSection.style.display = "block";
    };

    const renderSources = (sources) => {
        if (sources && sources.length > 0) {
            sourcesList.innerHTML = sources.map(source => `
                <a href="${source.url}" target="_blank" rel="noopener noreferrer" class="source-item">
                    <span class="source-icon">🔗</span>
                    <span class="source-title">${source.title || 'Source'}</span>
                </a>
            `).join('');
            sourcesSection.style.display = "block";
        }
    };

    async function loadRelatedQuestions(currentQuestion) {
        try {
            const response = await fetch(`http://localhost:8000/related-questions?question=${encodeURIComponent(currentQuestion)}`);
            
            if (response.ok) {
                const data = await response.json();
                renderRelatedQuestions(data.related_questions);
            } else {
                renderRelatedQuestions([
                    "How do I manage Arena2036 notifications?",
                    "What are the Arena2036 collaboration features?",
                    "How do I integrate third-party tools with Arena2036?",
                    "How do I export data from Arena2036?"
                ]);
            }
        } catch (error) {
            console.error("Error loading related questions:", error);
            renderRelatedQuestions([
                "How do I manage Arena2036 notifications?",
                "What are the Arena2036 collaboration features?",
                "How do I integrate third-party tools with Arena2036?",
                "How do I export data from Arena2036?"
            ]);
        }
    }

    function renderRelatedQuestions(questions) {
        const relatedQuestionsHTML = questions.map(question => 
            `<button class="related-question" data-question="${question}">${question}</button>`
        ).join('');
        
        relatedQuestionsList.innerHTML = relatedQuestionsHTML;
        
        relatedQuestionsList.querySelectorAll('.related-question').forEach(question => {
            question.addEventListener("click", () => {
                fetchAnswer(question.dataset.question);
            });
        });
    }

    const fetchAnswer = async (question) => {
        showAnswerSection(question);
        
        try {
            const response = await fetch(`http://localhost:8000/query?question=${encodeURIComponent(question)}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            renderMarkdownAnswer(data.answer);
            renderSources(data.sources);
            loadRelatedQuestions(question);
            
        } catch (error) {
            console.error("Error:", error);
            
            let errorMessage = "I'm having trouble connecting right now. Please try again in a moment.";
            
            if (error.message.includes('Failed to fetch')) {
                errorMessage = "Unable to connect to the server. Please check your connection and try again.";
            } else if (error.message.includes('500')) {
                errorMessage = "The server is experiencing issues. Please try again later.";
            }
            
            renderMarkdownAnswer(`## Error\n\n${errorMessage}`);
        }
    };

    // Event listeners
    searchInput.addEventListener("input", (e) => {
        const query = e.target.value.trim();
        searchInput.dataset.originalValue = query;
        
        if (suggestionTimeout) {
            clearTimeout(suggestionTimeout);
        }
        
        suggestionTimeout = setTimeout(() => {
            loadAutocompleteSuggestions(query);
        }, 150);
    });

    searchInput.addEventListener("keydown", handleSuggestionKeyboard);

    searchInput.addEventListener("focus", () => {
        const query = searchInput.value.trim();
        if (query.length >= 1) {
            loadAutocompleteSuggestions(query);
        }
    });

    document.addEventListener("click", (e) => {
        if (!e.target.closest('.search-wrapper')) {
            hideSuggestions();
        }
    });

    searchButton.addEventListener("click", () => {
        const question = searchInput.value.trim();
        if (question) {
            fetchAnswer(question);
        }
    });

    searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !suggestionsVisible) {
            const question = searchInput.value.trim();
            if (question) {
                fetchAnswer(question);
            }
        }
    });

    backButton.addEventListener("click", showHeroSection);

    document.getElementById("feedbackYes").addEventListener("click", function() {
        this.classList.add("active");
        document.getElementById("feedbackNo").classList.remove("active");
    });

    document.getElementById("feedbackNo").addEventListener("click", function() {
        this.classList.add("active");
        document.getElementById("feedbackYes").classList.remove("active");
    });

    searchInput.focus();
});
