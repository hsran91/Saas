(() => {
    const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
    const ACTIVITY_KEY = "employeeLastActivityAt";
    const token = localStorage.getItem("authToken");
    if (!token) return;

    let lastActivityWrite = 0;
    let logoutStarted = false;
    const initialActivity = Number(localStorage.getItem(ACTIVITY_KEY));
    if (!Number.isFinite(initialActivity) || initialActivity <= 0) {
        localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    }

    function getLastActivity() {
        return Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
    }

    function recordActivity() {
        if (logoutStarted) return;
        const now = Date.now();
        if (now - lastActivityWrite < 1000) return;
        lastActivityWrite = now;
        localStorage.setItem(ACTIVITY_KEY, String(now));
    }

    function removeCredentials() {
        localStorage.removeItem("authToken");
        localStorage.removeItem("employeeSessionId");
        localStorage.removeItem(ACTIVITY_KEY);
    }

    async function logoutForInactivity() {
        if (logoutStarted) return;
        logoutStarted = true;

        const sessionId = localStorage.getItem("employeeSessionId");
        const logoutKey = sessionId ? `employeeLogoutStarted:${sessionId}` : null;
        if (logoutKey && localStorage.getItem(logoutKey) === "true") {
            removeCredentials();
            window.location.replace("login.html");
            return;
        }
        if (logoutKey) localStorage.setItem(logoutKey, "true");

        const currentToken = localStorage.getItem("authToken");
        if (currentToken && sessionId) {
            try {
                const payload = JSON.parse(atob(currentToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
                const headers = {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${currentToken}`
                };
                if (payload.tenantId) headers["X-Tenant-Id"] = payload.tenantId;

                const response = await fetch(
                    `${window.location.protocol === "file:" ? "http://localhost:5000" : ""}/auth/logout`,
                    {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ sessionId })
                    }
                );
                if (!response.ok) {
                    const result = await response.json().catch(() => ({}));
                    throw new Error(result.error || result.message || "Unable to record logout time");
                }
            } catch (error) {
                console.error("Unable to record employee logout after inactivity:", error);
                window.alert("You have been logged out due to inactivity, but the logout time could not be recorded. Please notify an administrator.");
            }
        }

        removeCredentials();
        window.location.replace("login.html");
    }

    function checkForInactivity() {
        if (Date.now() - getLastActivity() >= IDLE_TIMEOUT_MS) {
            logoutForInactivity();
        }
    }

    ["pointerdown", "keydown", "touchstart", "scroll", "mousemove"].forEach(eventName => {
        window.addEventListener(eventName, recordActivity, { passive: true });
    });

    window.addEventListener("focus", () => {
        checkForInactivity();
        recordActivity();
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            checkForInactivity();
            recordActivity();
        }
    });
    window.addEventListener("storage", event => {
        if (event.key === "authToken" && !event.newValue) {
            logoutStarted = true;
            window.location.replace("login.html");
        }
    });

    window.setInterval(checkForInactivity, 5000);
})();
