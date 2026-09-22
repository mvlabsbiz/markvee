const $ = id => document.getElementById(id);
let TOKEN = '';
let POST_IMAGES = [];

/**
 * Downscale before upload. Phone photos are routinely 4-8MB; posting three of
 * them raw would push a single request past 20MB for no visible benefit.
 */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max = 2048;
        let w = img.width, h = img.height;
        if (w > max || h > max) {
          const ratio = Math.min(max / w, max / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function load() {
  try {
    const r = await fetch('/api/posts');
    const d = await r.json();
    TOKEN = localStorage.getItem('token') || '';
    
    // Show composer if authenticated
    if (d.canPost) {
      $('composer').hidden = false;
    }

    // Show profile + banner if they exist
    try {
      const profileHead = await fetch('/profile', { method: 'HEAD' });
      if (profileHead.ok) {
        $('profile-photo-container').hidden = false;
      }
    } catch {}

    try {
      const bannerHead = await fetch('/banner', { method: 'HEAD' });
      if (bannerHead.ok) {
        $('banner-container').hidden = false;
      }
    } catch {}

    renderPosts(d.posts);
  } catch (e) {
    console.error(e);
  }
}

function renderPosts(posts) {
  const html = posts.map(post => `
    <div class="post">
      <div class="post-header">${new Date(post.created).toLocaleDateString()}</div>
      <div class="post-text">${escapeHtml(post.text)}</div>
      ${post.images.length > 0 ? `
        <div class="post-images">
          ${post.images.map(img => `
            <div class="post-image">
              <img src="${img}" alt="Post image">
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');
  $('posts').innerHTML = html;
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Prompt for token if not in composer
function promptToken() {
  const token = prompt('Enter your owner token:');
  if (token) {
    localStorage.setItem('token', token);
    TOKEN = token;
    location.reload();
  }
}

// Profile photo upload
$('profile-btn').addEventListener('click', () => $('profile-file').click());
$('profile-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const base64 = await shrink(file, 512);
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image: base64 })
    });
    
    if (res.ok) {
      $('profile-photo-container').hidden = false;
      $('profile-img').src = '/profile?' + Date.now();
    } else {
      alert('Failed to upload profile photo');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
  e.target.value = '';
});

// Banner photo upload
$('banner-btn').addEventListener('click', () => $('banner-file').click());
$('banner-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const base64 = await shrink(file, 1920);
    const res = await fetch('/api/banner', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image: base64 })
    });
    
    if (res.ok) {
      $('banner-container').hidden = false;
      $('banner-img').src = '/banner?' + Date.now();
    } else {
      alert('Failed to upload banner');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
  e.target.value = '';
});

// Post photo selection
$('photo-upload-btn').addEventListener('click', () => $('post-photos').click());

$('post-photos').addEventListener('change', async e => {
  for (const file of e.target.files) {
    try {
      const base64 = await shrink(file);
      POST_IMAGES.push(base64);
      
      // Add preview
      const container = $('preview-container');
      const item = document.createElement('div');
      item.className = 'preview-item';
      item.innerHTML = `
        <img src="data:image/jpeg;base64,${base64}" alt="preview">
        <button type="button">×</button>
      `;
      item.querySelector('button').addEventListener('click', () => {
        POST_IMAGES = POST_IMAGES.filter(img => img !== base64);
        item.remove();
      });
      container.appendChild(item);
    } catch (err) {
      alert('Error processing image: ' + err.message);
    }
  }
  e.target.value = '';
});

// Post submit
$('post-btn').addEventListener('click', async () => {
  const text = $('post-text').value.trim();
  if (!text && POST_IMAGES.length === 0) {
    alert('Enter text or add photos');
    return;
  }

  if (!TOKEN) {
    promptToken();
    return;
  }

  try {
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        images: POST_IMAGES
      })
    });

    if (res.ok) {
      $('post-text').value = '';
      POST_IMAGES = [];
      $('preview-container').innerHTML = '';
      load();
    } else {
      alert('Failed to post');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

load();
