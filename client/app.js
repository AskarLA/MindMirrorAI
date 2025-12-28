// DOM Elements
const textInput = document.getElementById('textInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const charCount = document.getElementById('charCount');
const loadingSection = document.getElementById('loadingSection');
const errorSection = document.getElementById('errorSection');
const resultSection = document.getElementById('resultSection');
const errorMessage = document.getElementById('errorMessage');
const dismissErrorBtn = document.getElementById('dismissError');
const clearResultBtn = document.getElementById('clearResult');

// Result elements
const sentimentValue = document.getElementById('sentimentValue');
const themesList = document.getElementById('themesList');
const toneValue = document.getElementById('toneValue');
const summaryValue = document.getElementById('summaryValue');

const MAX_CHARS = 10000;

// Character counter
textInput.addEventListener('input', () => {
    const count = textInput.value.length;
    charCount.textContent = count.toLocaleString();
    
    // Update color based on character count
    if (count > MAX_CHARS * 0.9) {
        charCount.style.color = 'rgba(248, 113, 113, 0.9)';
    } else if (count > MAX_CHARS * 0.7) {
        charCount.style.color = 'rgba(251, 191, 36, 0.9)';
    } else {
        charCount.style.color = 'rgba(255, 255, 255, 0.6)';
    }
    
    // Enable/disable button based on content
    analyzeBtn.disabled = count === 0 || count > MAX_CHARS;
});

// Enter key handling (Shift+Enter for new line, Enter to submit)
textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        if (!analyzeBtn.disabled) {
            analyzeText();
        }
    }
});

// Analyze button click
analyzeBtn.addEventListener('click', analyzeText);

// Dismiss error
dismissErrorBtn.addEventListener('click', () => {
    hideError();
});

// Clear result
clearResultBtn.addEventListener('click', () => {
    hideResult();
    textInput.focus();
});

// Main analyze function
async function analyzeText() {
    const text = textInput.value.trim();
    
    // Validation
    if (!text) {
        showError('Please enter some text to analyze.');
        return;
    }
    
    if (text.length > MAX_CHARS) {
        showError(`Text exceeds the maximum length of ${MAX_CHARS.toLocaleString()} characters.`);
        return;
    }
    
    // Hide previous results and errors
    hideError();
    hideResult();
    showLoading();
    
    // Disable button during analysis
    analyzeBtn.disabled = true;
    
    try {
        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to analyze text');
        }
        
        if (data.success && data.analysis) {
            displayResults(data.analysis);
        } else {
            throw new Error('Invalid response from server');
        }
        
    } catch (error) {
        console.error('Error:', error);
        showError(error.message || 'An error occurred while analyzing the text. Please try again.');
    } finally {
        hideLoading();
        analyzeBtn.disabled = false;
    }
}

// Display results
function displayResults(analysis) {
    // Set sentiment
    const sentiment = (analysis.sentiment || 'neutral').toLowerCase();
    sentimentValue.textContent = sentiment;
    sentimentValue.className = 'sentiment-value ' + sentiment;
    
    // Set themes
    if (analysis.themes && Array.isArray(analysis.themes) && analysis.themes.length > 0) {
        themesList.innerHTML = analysis.themes
            .map(theme => `<span class="theme-tag">${escapeHtml(theme)}</span>`)
            .join('');
    } else {
        themesList.innerHTML = '<span class="theme-tag">No specific themes identified</span>';
    }
    
    // Set tone
    toneValue.textContent = analysis.tone || 'Not specified';
    
    // Set summary
    summaryValue.textContent = analysis.summary || 'No summary available';
    
    // Show result section with animation
    resultSection.classList.remove('hidden');
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Show loading
function showLoading() {
    loadingSection.classList.remove('hidden');
    loadingSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Hide loading
function hideLoading() {
    loadingSection.classList.add('hidden');
}

// Show error
function showError(message) {
    errorMessage.textContent = message;
    errorSection.classList.remove('hidden');
    errorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Hide error
function hideError() {
    errorSection.classList.add('hidden');
}

// Hide result
function hideResult() {
    resultSection.classList.add('hidden');
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize
textInput.focus();

