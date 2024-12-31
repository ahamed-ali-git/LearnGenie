const urlInput = document.querySelector('.url-input');
const generateBtn = document.querySelector('.url-input-container .btn');
const loadingSpinner = document.querySelector('.loading-spinner');
const videoTitle = document.querySelector('.video-title');
const videoMeta = document.querySelector('.video-meta');
const videoThumbnail = document.querySelector('.video-thumbnail');
const summaryContent = document.querySelector('.summary-content');

// Debug log to check if elements are found
console.log('Elements found:', {
    urlInput: !!urlInput,
    generateBtn: !!generateBtn,
    loadingSpinner: !!loadingSpinner,
    videoTitle: !!videoTitle,
    videoMeta: !!videoMeta,
    videoThumbnail: !!videoThumbnail,
    summaryContent: !!summaryContent
});

generateBtn.addEventListener('click', async () => {
    if (urlInput.value) {
        try {
            // Show loading spinner
            loadingSpinner.style.display = 'block';
            // Clear previous summary
            summaryContent.innerHTML = '';
            
            const response = await fetch('/api/summarize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: urlInput.value })
            });

            const data = await response.json();
            
            if (data.success) {
                // Update video preview
                videoTitle.textContent = data.data.videoTitle;
                videoMeta.textContent = `Duration: ${formatDuration(data.data.duration)} • Channel: ${data.data.channelName}`;
                videoThumbnail.src = data.data.thumbnail;
                
                // Update summary
                summaryContent.innerHTML = `<p>${data.data.summary}</p>`;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            summaryContent.innerHTML = `<p style="color: var(--error-color)">Error: ${error.message}</p>`;
        } finally {
            // Hide loading spinner
            loadingSpinner.style.display = 'none';
        }
    }
});

document.getElementById('generateQuiz')?.addEventListener('click', async function() {
    const quizDataElement = document.querySelector('.quiz-data');
    if (!quizDataElement) {
        console.error('No quiz data found');
        return;
    }

    try {
        const quizQuestions = JSON.parse(quizDataElement.dataset.quiz);
        
        const response = await fetch('/api/create-quiz', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ questions: quizQuestions })
        });
        
        if (response.ok) {
            window.location.href = '/quiz';
        }
    } catch (error) {
        console.error('Error:', error);
    }
});

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
