// Theme color picker functionality
const colorInput = document.getElementById('color-input');
const resetBtn = document.getElementById('reset-theme');
const defaultColor = '#1a3a52';

// Load saved color from localStorage on page load
window.addEventListener('DOMContentLoaded', () => {
    const savedColor = localStorage.getItem('markvee-bg-color');
    if (savedColor) {
        setBackgroundColor(savedColor);
        colorInput.value = savedColor;
    }
});

// Update background color when color input changes
colorInput.addEventListener('input', (e) => {
    const color = e.target.value;
    setBackgroundColor(color);
    localStorage.setItem('markvee-bg-color', color);
});

// Reset to default color
resetBtn.addEventListener('click', () => {
    setBackgroundColor(defaultColor);
    colorInput.value = defaultColor;
    localStorage.removeItem('markvee-bg-color');
});

// Helper function to set background color
function setBackgroundColor(color) {
    document.body.style.backgroundColor = color;
}
