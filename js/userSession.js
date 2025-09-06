/**
 * User Session Manager
 * Centralized user data management for consistent display across all pages
 */
class UserSessionManager {
    constructor() {
        this.currentUser = null;
        this.isAuthenticated = false;
    }

    /**
     * Load user data from localStorage
     */
    loadUserData() {
        try {
            const authToken = localStorage.getItem('authToken');
            const userData = localStorage.getItem('userData');
            
            if (!authToken || !userData) {
                this.isAuthenticated = false;
                return null;
            }
            
            const user = JSON.parse(userData);
            this.isAuthenticated = true;
            return user;
        } catch (error) {
            console.warn('Failed to load user data:', error);
            this.isAuthenticated = false;
            return null;
        }
    }

    /**
     * Check if user is authenticated
     */
    isUserAuthenticated() {
        const token = localStorage.getItem('authToken');
        return !!token && this.isAuthenticated;
    }

    /**
     * Redirect to login if not authenticated
     */
    requireAuthentication() {
        if (!this.isUserAuthenticated()) {
            window.location.href = 'auth.html';
            return false;
        }
        return true;
    }

    /**
     * Fetch real user data from backend
     */
    async fetchUserData() {
        try {
            const token = localStorage.getItem('authToken');
            if (!token) {
                throw new Error('No authentication token');
            }
            
            // Check if backend is available
            let response;
            try {
                response = await fetch('/api/users/profile', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (fetchError) {
                console.warn('Backend not available, using cached user data');
                return this.currentUser;
            }
            
            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.warn('Backend returned non-JSON response, using cached data');
                return this.currentUser;
            }
            
            if (!response.ok) {
                throw new Error('Failed to fetch user data');
            }
            
            const userData = await response.json();
            
            // Update local storage and current user
            localStorage.setItem('userData', JSON.stringify(userData));
            this.currentUser = userData;
            this.isAuthenticated = true;
            
            return userData;
        } catch (error) {
            console.error('Failed to fetch user data:', error);
            
            // Don't logout on fetch failure, use cached data
            if (this.currentUser) {
                console.warn('Using cached user data due to backend unavailability');
                return this.currentUser;
            }
            
            this.logout();
            throw error;
        }
    }
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch user data');
            }
            
            const userData = await response.json();
            
            // Update local storage and current user
            localStorage.setItem('userData', JSON.stringify(userData));
            this.currentUser = userData;
            this.isAuthenticated = true;
            
            return userData;
        } catch (error) {
            console.error('Failed to fetch user data:', error);
            this.logout();
            throw error;
        }
    }

    /**
     * Save user data to localStorage
     */
    saveUserData() {
        try {
            localStorage.setItem('userData', JSON.stringify(this.currentUser));
        } catch (error) {
            console.warn('Failed to save user data to localStorage:', error);
        }
    }

    /**
     * Get current user data
     */
    getCurrentUser() {
        if (!this.currentUser) {
            this.currentUser = this.loadUserData();
        }
        return this.currentUser ? { ...this.currentUser } : null;
    }

    /**
     * Update user data
     */
    updateUser(userData) {
        if (!this.currentUser) {
            this.currentUser = this.loadUserData();
        }
        
        if (this.currentUser) {
            this.currentUser = { ...this.currentUser, ...userData };
        } else {
            this.currentUser = userData;
        }
        
        this.saveUserData();
        this.updateAllDisplays();
        
        // Log credit updates for debugging
        if (userData.credits !== undefined) {
            const maxCredits = this.getMaxCredits();
            console.log(`User credits updated: ${userData.credits}/${maxCredits}`);
        }
    }

    /**
     * Get max credits based on plan
     */
    getMaxCredits() {
        if (!this.currentUser) return 200;
        
        switch (this.currentUser.plan) {
            case 'pro': return 2000;
            case 'custom': return 3300;
            default: return 200;
        }
    }

    /**
     * Get formatted plan display text
     */
    getPlanDisplayText() {
        if (!this.currentUser) return 'Not Logged In';
        
        switch (this.currentUser.plan) {
            case 'free':
                return 'Free Plan';
            case 'pro':
                return 'Pro Plan';
            case 'custom':
                return 'Custom Plan';
            default:
                return 'Free Plan';
        }
    }

    /**
     * Get formatted credits display text
     */
    getCreditsDisplayText() {
        if (!this.currentUser) return '0/0 Credits';
        
        const maxCredits = this.getMaxCredits();
        return `${this.currentUser.credits || 0}/${maxCredits} Credits`;
    }

    /**
     * Update all user displays on the current page
     */
    updateAllDisplays() {
        if (!this.currentUser) {
            this.showNotLoggedInState();
            return;
        }
        
        // Update sidebar user info
        const userNameEl = document.getElementById('user-name');
        const userPlanEl = document.getElementById('user-plan');
        const userCreditsEl = document.getElementById('user-credits');
        
        if (userNameEl) userNameEl.textContent = this.currentUser.name;
        if (userPlanEl) userPlanEl.textContent = this.getPlanDisplayText();
        if (userCreditsEl) userCreditsEl.textContent = this.getCreditsDisplayText();
        
        // Update modal user info
        const modalUserNameEl = document.getElementById('modal-user-name');
        const modalUserEmailEl = document.getElementById('modal-user-email');
        const modalUserPlanEl = document.getElementById('modal-user-plan');
        const modalUserCreditsEl = document.getElementById('modal-user-credits');
        
        if (modalUserNameEl) modalUserNameEl.textContent = this.currentUser.name;
        if (modalUserEmailEl) modalUserEmailEl.textContent = this.currentUser.email;
        if (modalUserPlanEl) modalUserPlanEl.textContent = this.getPlanDisplayText();
        if (modalUserCreditsEl) modalUserCreditsEl.textContent = this.getCreditsDisplayText();
    }

    /**
     * Show not logged in state
     */
    showNotLoggedInState() {
        const userNameEl = document.getElementById('user-name');
        const userPlanEl = document.getElementById('user-plan');
        const userCreditsEl = document.getElementById('user-credits');
        
        if (userNameEl) userNameEl.textContent = 'Not Logged In';
        if (userPlanEl) userPlanEl.textContent = 'No Plan';
        if (userCreditsEl) userCreditsEl.textContent = '0/0 Credits';
    }

    /**
     * Initialize user session on page load
     */
    async init() {
        // Reload user data from localStorage in case it was updated
        this.currentUser = this.loadUserData();
        
        // If user data exists, try to fetch fresh data from backend
        if (this.currentUser && this.isUserAuthenticated()) {
            try {
                await this.fetchUserData();
            } catch (error) {
                console.warn('Failed to fetch fresh user data:', error);
            }
        }
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.updateAllDisplays();
            });
        } else {
            this.updateAllDisplays();
        }
    }

    /**
     * Logout user
     */
    logout() {
        if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            localStorage.removeItem('user');
            this.currentUser = null;
            this.isAuthenticated = false;
            window.location.href = 'auth.html';
        }
    }

    /**
     * Check if user has pro features
     */
    hasProFeatures() {
        return this.currentUser.plan === 'pro' || this.currentUser.plan === 'custom';
    }

    /**
     * Check if user has sufficient credits
     */
    hasSufficientCredits(requiredCredits) {
        return this.currentUser.credits >= requiredCredits;
    }

    /**
     * Deduct credits (for demo purposes)
     */
    deductCredits(amount) {
        if (this.currentUser.credits >= amount) {
            this.currentUser.credits -= amount;
            this.saveUserData();
            this.updateAllDisplays();
            return true;
        }
        return false;
    }
}

// Create global instance
window.userSession = new UserSessionManager();

// Auto-initialize
window.userSession.init();

// Global logout function for backward compatibility
window.logout = function() {
    window.userSession.logout();
};
