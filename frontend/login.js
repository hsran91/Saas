const API_BASE = window.location.protocol === "file:" ? "http://localhost:5000" : "";

function saveToken(token) {
    localStorage.setItem("authToken", token);
}

function switchForm(showLogin) {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const showLoginBtn = document.getElementById("showLogin");
    const showRegisterBtn = document.getElementById("showRegister");

    if (showLogin) {
        loginForm.style.display = "grid";
        registerForm.style.display = "none";
        showLoginBtn.classList.add("active-toggle");
        showRegisterBtn.classList.remove("active-toggle");
    } else {
        loginForm.style.display = "none";
        registerForm.style.display = "grid";
        showLoginBtn.classList.remove("active-toggle");
        showRegisterBtn.classList.add("active-toggle");
    }
}

function login(event) {
    event.preventDefault();
    const username = document.getElementById("username").value.trim();
    const tenantId = document.getElementById("tenantId")?.value.trim();
    const password = document.getElementById("password").value.trim();
    const errorBox = document.getElementById("loginError");

    errorBox.style.display = "none";

    if (!username || !password) {
        errorBox.textContent = "Username and password are required.";
        errorBox.style.display = "block";
        return;
    }

    fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, tenantId: tenantId || undefined })
    })
        .then(async res => {
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(payload.error || payload.message || "Login failed");
            }
            return payload;
        })
        .then(data => {
            saveToken(data.token);
            localStorage.setItem("employeeSessionId", data.sessionId);
            localStorage.setItem("employeeLastActivityAt", String(Date.now()));
            window.location.href = "index.html";
        })
        .catch(err => {
            errorBox.textContent = err.message || "Unable to login.";
            errorBox.style.display = "block";
        });
}

function register(event) {
    event.preventDefault();
    const name = document.getElementById("regName").value.trim();
    const username = document.getElementById("regUsername").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value.trim();
    const role = document.getElementById("regRole").value;
    const residentId = document.getElementById("regResidentId").value.trim();
    const errorBox = document.getElementById("registerError");

    errorBox.style.display = "none";

    if (!name || !username || !email || !password || !role) {
        errorBox.textContent = "All fields except resident ID are required.";
        errorBox.style.display = "block";
        return;
    }

    const rolePrefixes = {
        admin: "adm",
        medtech: "med",
        rn: "med",
        poa: "res"
    };

    if (!username.startsWith(rolePrefixes[role])) {
        errorBox.textContent = `Username must start with ${rolePrefixes[role]} for role ${role}.`;
        errorBox.style.display = "block";
        return;
    }

    const payload = {
        name,
        username,
        email,
        password,
        role
    };

    if (role === "poa") {
        if (!residentId) {
            errorBox.textContent = "Resident ID is required for POA users.";
            errorBox.style.display = "block";
            return;
        }
        payload.residentId = residentId;
    }

    fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(async res => {
            const result = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(result.error || result.message || "Registration failed");
            }
            return result;
        })
        .then(() => {
            switchForm(true);
            document.getElementById("loginForm").reset();
            document.getElementById("registerForm").reset();
            alert("Registration successful. Please login.");
        })
        .catch(err => {
            errorBox.textContent = err.message || "Unable to register.";
            errorBox.style.display = "block";
        });
}

document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("authToken");
    if (token) {
        window.location.href = "index.html";
        return;
    }

    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const showLogin = document.getElementById("showLogin");
    const showRegister = document.getElementById("showRegister");
    const roleSelect = document.getElementById("regRole");
    const residentIdGroup = document.getElementById("residentIdGroup");

    if (loginForm) {
        loginForm.addEventListener("submit", login);
    }
    if (registerForm) {
        registerForm.addEventListener("submit", register);
    }
    if (showLogin) {
        showLogin.addEventListener("click", () => switchForm(true));
    }
    if (showRegister) {
        showRegister.addEventListener("click", () => switchForm(false));
    }
    if (roleSelect) {
        roleSelect.addEventListener("change", () => {
            residentIdGroup.style.display = roleSelect.value === "poa" ? "block" : "none";
        });
    }
});
