/**
 * User Session Manager
 * Centralized user data management for consistent display across all pages
 */
class UserSessionManager {
    constructor() {
        this.defaultUser = {
            name: 'User Name',
            email: 'john.doe@example.com',
            plan: 'free', // 'free', 'pro', or 'custom'
            credits: 145,
            maxCredits: 200
        };
        
        this.currentUser = this.loadUserData();
    }

    /**
     * Load user data from localStorage or use default
     */
    loadUserData() {
        try {
            // First try to load from 'user' key (set during login/signup)
            let storedUser = localStorage.getItem('user');
            if (storedUser) {
                const userData = JSON.parse(storedUser);
                // Convert to our format and save to 'userData' for consistency
                const formattedData = {
                    name: userData.name || this.defaultUser.name,
                    email: userData.email || this.defaultUser.email,
                    plan: userData.plan || 'free',
                    credits: userData.credits || this.defaultUser.credits,
                    maxCredits: userData.plan === 'pro' ? 1000 : userData.plan === 'custom' ? 2000 : 200
                };
                localStorage.setItem('userData', JSON.stringify(formattedData));
                return formattedData;
            }
            
            // Fallback to 'userData' key
            storedUser = localStorage.getItem('userData');
            if (storedUser) {
                const userData = JSON.parse(storedUser);
                return { ...this.defaultUser, ...userData };
            }
        } catch (error) {
            console.warn('Failed to load user data from localStorage:', error);
        }
        return { ...this.defaultUser };
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
        return { ...this.currentUser };
    }

    /**
     * Update user data
     */
    updateUser(userData) {
        this.currentUser = { ...this.currentUser, ...userData };
        this.saveUserData();
        this.updateAllDisplays();
    }

    /**
     * Get formatted plan display text
     */
    getPlanDisplayText() {
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
        return `${this.currentUser.credits}/${this.currentUser.maxCredits} Credits`;
    }

    /**
     * Update all user displays on the current page
     */
    updateAllDisplays() {
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
     * Initialize user session on page load
     */
    init() {
        // Reload user data from localStorage in case it was updated
        this.currentUser = this.loadUserData();
        
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
            localStorage.removeItem('userToken');
            localStorage.removeItem('userData');
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
