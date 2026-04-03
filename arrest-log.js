// ========================================
// ARREST LOGS SYSTEM - REDESIGNED
// FBI TEAM ROBLOX
// ========================================

let arrestsCache = [];
let isAgent = false;

// ========================================
// AGENT AUTHENTICATION
// ========================================

const AGENT_EMAIL = 'agent@ftr.com';

firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        if (user.email === AGENT_EMAIL) {
            currentUser = user;
            isAgent = true;
            isAdmin = false;
            updateAgentUI(true);
            console.log('✓ Agent authenticated:', user.email);
            showArrestLogsTab();
        }
        else if (ADMIN_EMAILS.includes(user.email)) {
            currentUser = user;
            isAdmin = true;
            isAgent = false;
            updateAdminUI(true);
            console.log('✓ Admin authenticated:', user.email);
            showArrestLogsTab();
        }
        else {
            currentUser = user;
            isAdmin = false;
            isAgent = false;
            updateAdminUI(false);
            updateAgentUI(false);
            console.warn('⚠ User not authorized:', user.email);
            alert('You are not authorized.');
            firebase.auth().signOut();
        }
    } else {
        currentUser = null;
        isAdmin = false;
        isAgent = false;
        updateAdminUI(false);
        updateAgentUI(false);
        hideArrestLogsTab();
        console.log('✗ No user authenticated');
    }
});

// ========================================
// LOAD ARRESTS
// ========================================

async function loadArrests() {
    try {
        const data = await getData('arrests');
        
        if (data) {
            arrestsCache = Object.values(data);
            arrestsCache.sort((a, b) => b.timestamp - a.timestamp);
        } else {
            arrestsCache = [];
        }
        
        renderArrests();
    } catch (error) {
        console.error('Error loading arrests:', error);
        document.getElementById('arrestsLoading').textContent = 'Error loading arrests';
    }
}

// ========================================
// SAVE ARRESTS
// ========================================

async function saveArrests() {
    const arrestsObj = {};
    arrestsCache.forEach(arrest => {
        arrestsObj[arrest.id] = arrest;
    });
    await saveData('arrests', arrestsObj);
}

// ========================================
// ADD ARREST
// ========================================

function showAddArrest() {
    document.getElementById('addArrestModal').classList.add('active');
}

async function addArrest() {
    if (!isAgent && !isAdmin) {
        alert('Agent or Admin access required!');
        return;
    }

    const suspects = document.getElementById('arrestSuspects').value.trim();
    const primaryAgent = document.getElementById('arrestPrimaryAgent').value.trim();
    const secondaryAgents = document.getElementById('arrestSecondaryAgents').value.trim();
    const crime = document.getElementById('arrestCrime').value.trim();
    const imageUrl = document.getElementById('arrestImage').value.trim();

    if (!suspects || !primaryAgent || !crime) {
        alert('Please fill all required fields (Suspects, Primary Agent, and Crime)!');
        return;
    }

    const newArrest = {
        id: Date.now(),
        suspects,
        primaryAgent,
        secondaryAgents: secondaryAgents || 'None',
        crime,
        imageUrl: imageUrl || '',
        timestamp: Date.now(),
        filedBy: currentUser.email
    };

    arrestsCache.unshift(newArrest);
    await saveArrests();
    renderArrests();
    closeModal('addArrestModal');
    
    document.getElementById('arrestSuspects').value = '';
    document.getElementById('arrestPrimaryAgent').value = '';
    document.getElementById('arrestSecondaryAgents').value = '';
    document.getElementById('arrestCrime').value = '';
    document.getElementById('arrestImage').value = '';
    
    alert('✅ Arrest log successfully added!');
}

// ========================================
// DELETE ARREST
// ========================================

async function deleteArrest(id) {
    if (!isAdmin) {
        alert('Only admins can delete arrest logs!');
        return;
    }
    
    if (confirm('Delete this arrest log?')) {
        arrestsCache = arrestsCache.filter(a => a.id !== id);
        await saveArrests();
        renderArrests();
    }
}

// ========================================
// FILTER ARRESTS
// ========================================

function getFilteredArrests() {
    const search = document.getElementById('arrestSearch').value.toLowerCase();
    
    return arrestsCache.filter(arrest => 
        arrest.suspects.toLowerCase().includes(search) ||
        arrest.primaryAgent.toLowerCase().includes(search) ||
        arrest.crime.toLowerCase().includes(search)
    );
}

function filterArrests() {
    renderArrests();
}

// ========================================
// RENDER ARRESTS - NEW DESIGN
// ========================================

function renderArrests() {
    const grid = document.getElementById('arrestsGrid');
    const loading = document.getElementById('arrestsLoading');
    const filteredArrests = getFilteredArrests();
    
    loading.style.display = 'none';
    grid.style.display = 'grid';
    
    if (filteredArrests.length === 0) {
        grid.innerHTML = `
            <div class="card" style="grid-column: 1 / -1; text-align: center; padding: 4rem;">
                <div class="card-icon" style="margin: 0 auto 1.5rem;">📝</div>
                <h3 class="card-title">No Arrest Logs Found</h3>
                <p class="card-text">
                    ${isAgent || isAdmin ? 'Click "+ New Arrest Log" to create your first arrest record.' : 'No arrests have been logged yet.'}
                </p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = filteredArrests.map((arrest, index) => {
        const arrestNumber = String(filteredArrests.length - index).padStart(3, '0');
        const date = new Date(arrest.timestamp);
        const dateStr = date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
        const timeStr = date.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
        
        return `
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1.5rem;">
                    <div class="card-icon">📋</div>
                    <span class="badge badge-status" style="font-family: 'JetBrains Mono', monospace;">
                        #${arrestNumber}
                    </span>
                </div>
                
                <h3 class="card-title">Arrest Log ${arrestNumber}</h3>
                
                <div class="card-text" style="line-height: 1.9;">
                    <p><strong style="color: var(--primary-light);">Suspect(s):</strong> ${arrest.suspects}</p>
                    <p><strong style="color: var(--primary-light);">Primary Agent:</strong> ${arrest.primaryAgent}</p>
                    <p><strong style="color: var(--primary-light);">Secondary Agent(s):</strong> ${arrest.secondaryAgents}</p>
                    <p><strong style="color: var(--primary-light);">Crime:</strong> ${arrest.crime}</p>
                    <p><strong style="color: var(--primary-light);">Date:</strong> ${dateStr} at ${timeStr}</p>
                </div>
                
                ${arrest.imageUrl ? `
                    <div style="margin-top: 1.5rem; border-radius: 12px; overflow: hidden; border: 1px solid var(--glass-border);">
                        <img src="${arrest.imageUrl}" 
                             alt="Arrest Evidence" 
                             style="width: 100%; display: block;"
                             onerror="this.parentElement.style.display='none'">
                    </div>
                ` : ''}
                
                ${isAdmin ? `
                    <button class="btn-primary" 
                            style="margin-top: 1.5rem; width: 100%; padding: 0.75rem 1.5rem; background: linear-gradient(135deg, var(--danger), #dc2626);" 
                            onclick="deleteArrest(${arrest.id})">
                        Delete Log
                    </button>
                ` : ''}
            </div>
        `;
    }).join('');
}

// ========================================
// INITIALIZE ARRESTS
// ========================================

async function initializeArrests() {
    if (isAgent || isAdmin) {
        await loadArrests();
    }
}

// Export functions
window.showAddArrest = showAddArrest;
window.addArrest = addArrest;
window.deleteArrest = deleteArrest;
window.filterArrests = filterArrests;
window.initializeArrests = initializeArrests;

console.log('✓ Arrest Logs system loaded (NEW DESIGN)');
