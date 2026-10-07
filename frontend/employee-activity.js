const API_BASE = window.location.protocol === "file:" ? "http://localhost:5000" : "";
let employeeCount = 0;

function getEmployeeAuthHeaders() {
    const token = localStorage.getItem("authToken");
    if (!token) {
        window.location.href = "login.html";
        throw new Error("Please log in to view employee activity.");
    }

    const headers = { Authorization: `Bearer ${token}` };
    try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload.tenantId) headers["X-Tenant-Id"] = payload.tenantId;
    } catch (error) {
        console.error("Unable to read tenant context from the login token:", error);
    }
    return headers;
}

async function employeeActivityFetch(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        headers: getEmployeeAuthHeaders()
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
        localStorage.removeItem("authToken");
        localStorage.removeItem("employeeSessionId");
        window.location.href = "login.html";
        throw new Error("Your session expired. Please log in again.");
    }
    if (!response.ok) {
        throw new Error(payload.error || payload.message || "Request failed");
    }
    return payload;
}

function createSessionRow(session) {
    const row = document.createElement("div");
    row.className = "employee-session-row";

    const login = document.createElement("span");
    const loginLabel = document.createElement("strong");
    loginLabel.textContent = "Logged in: ";
    login.append(loginLabel, document.createTextNode(new Date(session.loginAt).toLocaleString()));

    const logout = document.createElement("span");
    const logoutLabel = document.createElement("strong");
    logoutLabel.textContent = "Logged out: ";
    logout.append(
        logoutLabel,
        document.createTextNode(session.logoutAt ? new Date(session.logoutAt).toLocaleString() : "No logout recorded")
    );

    row.append(login, logout);
    return row;
}

async function loadEmployeeSessionHistory(employeeId, employeeName) {
    const panel = document.getElementById("employeeSessionPanel");
    const title = document.getElementById("employeeSessionTitle");
    const message = document.getElementById("employeeSessionMessage");
    const sessionList = document.getElementById("employeeSessionList");
    const cardList = document.getElementById("employeeCardList");

    panel.style.display = "block";
    title.textContent = `${employeeName} - Login History`;
    message.textContent = "Loading login history...";
    sessionList.replaceChildren();

    try {
        const sessions = await employeeActivityFetch(
            `/dashboard/employees/${encodeURIComponent(employeeId)}/sessions`
        );
        message.textContent = sessions.length
            ? ""
            : "No login activity has been recorded for this employee.";
        sessions.forEach(session => sessionList.appendChild(createSessionRow(session)));
        cardList.style.display = "none";
    } catch (error) {
        console.error("Unable to load employee login history:", error);
        message.textContent = error.message || "Unable to load employee login history.";
    }
}

async function loadEmployeeCards() {
    const message = document.getElementById("employeeDirectoryMessage");
    const cardList = document.getElementById("employeeCardList");

    try {
        const employees = await employeeActivityFetch("/dashboard/employees");
        employeeCount = employees.length;
        message.textContent = employeeCount ? "" : "No employee accounts were found.";
        employees.forEach(employee => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "card employee-card";
            card.dataset.employeeName = employee.name.toLocaleLowerCase();

            const name = document.createElement("strong");
            name.textContent = employee.name;
            const role = document.createElement("p");
            role.className = "employee-role";
            role.textContent = employee.role;

            card.append(name, role);
            card.addEventListener("click", () => {
                loadEmployeeSessionHistory(employee.id, employee.name);
            });
            cardList.appendChild(card);
        });
    } catch (error) {
        console.error("Unable to load employee cards:", error);
        message.textContent = error.message || "Unable to load employee cards.";
    }
}

function filterEmployeeCards(searchTerm) {
    const message = document.getElementById("employeeDirectoryMessage");
    const cards = document.querySelectorAll("#employeeCardList .employee-card");
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
    let visibleCount = 0;

    cards.forEach(card => {
        const matches = card.dataset.employeeName.includes(normalizedSearch);
        card.hidden = !matches;
        if (matches) visibleCount += 1;
    });

    if (employeeCount && visibleCount === 0) {
        message.textContent = "No employees match your search.";
    } else if (employeeCount) {
        message.textContent = "";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("backToEmployeesButton").addEventListener("click", () => {
        document.getElementById("employeeSessionPanel").style.display = "none";
        document.getElementById("employeeCardList").style.display = "grid";
    });
    document.getElementById("employeeSearch").addEventListener("input", event => {
        filterEmployeeCards(event.target.value);
    });
    loadEmployeeCards();
});
