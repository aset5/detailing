document.addEventListener("DOMContentLoaded", () => {

    // ==========================================================================
    // 1. MOBILE RESPONSIVE HAMBURGER MENU DRAWER TOGGLE
    // ==========================================================================
    const menuToggle = document.getElementById("menuToggle");
    const navMenu = document.getElementById("navMenu");

    if (menuToggle && navMenu) {
        menuToggle.addEventListener("click", () => {
            navMenu.classList.toggle("mobile-open");
            
            // Toggle hamburger icon appearance 
            const icon = menuToggle.querySelector("i");
            if (navMenu.classList.contains("mobile-open")) {
                icon.className = "fa-solid fa-xmark";
            } else {
                icon.className = "fa-solid fa-bars";
            }
        });

        // Auto-close menu drawer when clicking individual mobile nav link items
        document.querySelectorAll(".nav-item").forEach(link => {
            link.addEventListener("click", () => {
                navMenu.classList.remove("mobile-open");
                menuToggle.querySelector("i").className = "fa-solid fa-bars";
            });
        });
    }

    // ==========================================================================
    // 2. SMOOTH INNER PAGE ANCHOR LINKS SCROLL MECHANICS
    // ==========================================================================
    document.querySelectorAll(".inner-scroll-link, .nav-item").forEach(anchor => {
        anchor.addEventListener("click", function(e) {
            const targetId = this.getAttribute("href");
            if (targetId && targetId.startsWith("#")) {
                e.preventDefault();
                const targetElement = document.querySelector(targetId);
                
                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });
                }
            }
        });
    });

    // ==========================================================================
    
    // ==========================================================================
    // 4. ON-SCROLL ELEMENTS LAZY TRANSITION EFFECTS (IntersectionObserver)
    // ==========================================================================
    const revealElements = document.querySelectorAll(".reveal-element");

    const revealCallback = (entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("active");
                // Stop tracking item once faded up smoothly
                observer.unobserve(entry.target);
            }
        });
    };

    const revealObserver = new IntersectionObserver(revealCallback, {
        root: null, // Default viewport tracking
        threshold: 0.15, // Trigger when 15% visible
        rootMargin: "0px 0px -40px 0px" // Slight offset padding base
    });

    revealElements.forEach(elem => {
        revealObserver.observe(elem);
    });

});

// Infinite Moving Review Ticker Controller
document.addEventListener("DOMContentLoaded", () => {
    const track = document.getElementById("review-track");
    if (!track) return;

    let speed = 0.1; // Control velocity (Higher numbers = Faster movement speeds)
    let currentPosition = 0;
    let isPaused = false;

    function animateTicker() {
        if (!isPaused) {
            currentPosition -= speed;
            
            // Checks if first half of items fully slid out of layout window view
            // Divides total offset by 2 to jump back cleanly for seamless illusions
            if (Math.abs(currentPosition) >= track.scrollWidth / 2) {
                currentPosition = 0;
            }
            
            track.style.transform = `translateX(${currentPosition}px)`;
        }
        requestAnimationFrame(animateTicker);
    }

    // Interactive Hover Listeners
    track.addEventListener("mouseenter", () => isPaused = true);
    track.addEventListener("mouseleave", () => isPaused = false);

    // Kickstart safe loop runtime
    animateTicker();
});