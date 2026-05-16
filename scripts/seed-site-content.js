/**
 * Seeds default copy for every page of the marketing site.
 *
 * Idempotent: only inserts a page if it doesn't already exist (uses $setOnInsert).
 * Running this twice is safe and won't overwrite admin edits.
 *
 * Usage (standalone):   node scripts/seed-site-content.js
 * Hooked into bootstrap via ensureSeed.js as well.
 */

import SiteContent from '../models/siteContent.model.js';

const DEFAULTS = {
  global: {
    pageName: 'Global (Header & Footer)',
    sections: {
      siteName: 'Prophetic Pathway',
      logo: '',
      logoDark: '',
      nav: [
        { label: 'Home', href: '/' },
        { label: 'How it Works', href: '/how-it-works' },
        { label: 'Advisors', href: '/advisors' },
        { label: 'Join as Advisor', href: '/join-as-advisor' },
        { label: 'Reviews', href: '/reviews' },
        { label: 'Blogs', href: '/blogs' }
      ],
      auth: { loginLabel: 'Log in', signupLabel: 'Get Started' },
      footer: {
        tagline:
          "The world's most trusted platform for spiritual guidance. Real-time connection with verified advisors via chat, voice, and video.",
        columns: [
          {
            title: 'PLATFORM',
            links: [
              { label: 'How it Works', href: '/how-it-works' },
              { label: 'Advisors', href: '/advisors' },
              { label: 'Reviews', href: '/reviews' },
              { label: 'Blog', href: '/blogs' }
            ]
          },
          {
            title: 'Company',
            links: [
              { label: 'About Us', href: '/about' },
              { label: 'Join as Advisor', href: '/join-as-advisor' }
            ]
          },
          {
            title: 'Support',
            links: [
              { label: 'Booking an Appointment', href: '/how-it-works' },
              { label: 'Satisfaction Guarantee', href: '/reviews' },
              { label: 'Contact Us', href: '/contact' },
              { label: 'Privacy & Policy', href: '/privacy' },
              { label: 'Terms of Service', href: '/terms' }
            ]
          }
        ],
        socialLinks: [
          { platform: 'facebook', href: '#' },
          { platform: 'twitter', href: '#' },
          { platform: 'instagram', href: '#' },
          { platform: 'linkedin', href: '#' }
        ],
        appStoreLink: '#',
        playStoreLink: '#',
        copyright: '© 2026 Prophetic Pathway. All rights reserved . For entertainment purposes.',
        contact: {
          email: 'Support@propheticpathway.com',
          phone: '0800 123 4567',
          address: 'London, United Kingdom'
        }
      }
    }
  },

  home: {
    pageName: 'Home',
    sections: {
      hero: {
        badge: '1,200+ Advisors Online Now',
        title: 'Connect with trusted Spiritual Advisors Instantly',
        highlightedWord: 'trusted',
        subtitle: 'Get instant guidance through chat, voice, or video sessions with verified spiritual advisors. Find clarity, comfort, and direction whenever you need it.',
        backgroundImage: '',
        ctaPrimary: { label: 'Talk to Someone Now', href: '/advisors' },
        ctaSecondary: { label: 'Explore Advisors', href: '/advisors' }
      },
      howItWorks: {
        sectionLabel: 'Simple Process',
        title: 'How Prophetic pathway Works',
        subtitle: 'Get started in minutes and connect with spiritual guidance whenever you need it',
        steps: [
          { icon: 'user', title: 'Choose Your Advisor', description: 'Browse verified spiritual advisors and find your perfect match based on reviews, expertise, and availability.' },
          { icon: 'video', title: 'Start Your Session', description: 'Connect instantly via chat, voice, or video. Pay per minute, end any time. Get a full transcript and recording after the session.' },
          { icon: 'card', title: 'Pay Per Minute', description: 'Transparent pricing with no hidden fees. Only pay for the time you use with flexible wallet and subscription options.' },
          { icon: 'star', title: 'Get Clarity', description: 'Receive guidance, insights, and spiritual support. All sessions can be recorded and transcribed for your reference.' }
        ]
      },
      watchInAction: {
        sectionLabel: 'See How it Works',
        title: 'Watch Our Platform in Action',
        subtitle: 'Discover how Pathway connects you with trusted spiritual advisors through private sessions that bring clarity, comfort, and divine direction.',
        videoUrl: '',
        posterImage: ''
      },
      featuredAdvisorsHeader: {
        sectionLabel: 'OUR ADVISORS',
        title: 'Select a Verified Advisor for Your Prophetic Consultation',
        subtitle: 'For nearly a decade, we have operated at the forefront of prophetic consultation and spiritual guidance.',
        viewAllLabel: 'View All 1,200+ Advisors'
      },
      whyChoose: {
        sectionLabel: 'Why Prophetic pathway',
        title: 'Find Clarity, Comfort, and Real Human Connection',
        subtitle: "Connect with trusted spiritual advisors who are here to listen, guide, and support you through life's most personal moments. Whether you're seeking relationship insight, emotional clarity, career direction, or spiritual reassurance, Prophetic Pathway gives you instant access to meaningful one-on-one guidance anytime, anywhere.",
        cards: [
          { icon: 'shield-check', title: 'Trusted & Verified Advisors', description: 'Every advisor goes through a detailed approval and interview process to ensure authentic guidance, professionalism, and compassionate communication.' },
          { icon: 'chat', title: 'Instant Chat, Voice & Video Sessions', description: 'Connect the way you feel most comfortable. Start a private session instantly through chat, voice, or live video from anywhere in the world.' },
          { icon: 'lock', title: 'Safe & Confidential Experience', description: 'Your sessions stay private and secure. We prioritize trust, confidentiality, and a respectful environment for every conversation.' },
          { icon: 'compass', title: 'Personalized Spiritual Guidance', description: 'Receive support tailored to your unique situation, emotions, and life journey instead of generic advice or automated responses.' },
          { icon: 'globe', title: 'Available Anytime You Need Support', description: 'Our global advisor network is available across multiple time zones, so guidance is always within reach whenever life feels uncertain.' },
          { icon: 'star', title: 'Real Reviews From Real People', description: 'Explore genuine experiences, honest feedback, and trusted ratings from people who have already connected with our advisors.' }
        ]
      },
      appPromo: {
        eyebrow: 'Try Our Application',
        title: 'Get Instant Spiritual Guidance Wherever Life Takes You',
        subtitle: 'Connect with trusted advisors anytime through private chat, voice, or video sessions right from your phone. Whether you need clarity, reassurance, or someone to truly listen, Prophetic Pathway keeps meaningful guidance just one tap away.',
        features: [
          'Connect instantly through chat, voice, or video',
          'Get guidance anytime, anywhere you need support',
          'Save favorite advisors and reconnect (replace with "easily")',
          'Secure and private spiritual conversations',
          'Receive personalized insight tailored to your journey'
        ],
        appStoreLink: '#',
        playStoreLink: '#',
        screenshotImages: []
      },
      testimonialsHeader: {
        sectionLabel: 'Reviews',
        title: 'What Our Customers Say',
        subtitle: 'Thousands of people find clarity, comfort, and guidance every day on Prophetic pathway',
        trustpilotRating: '4.8 Out of 5',
        totalReviews: '56,714 reviews'
      },
      cta: {
        eyebrow: '',
        title: 'Ready for your prophetic consultation?',
        subtitle: 'Join over 200,000+ people who\'ve found clarity, direction, and peace through Prophetic pathway. Your first session includes free minutes.',
        buttonPrimary: { label: 'Start Your First Session', href: '/advisors' },
        buttonSecondary: { label: 'Browse Advisors', href: '/advisors' }
      },
      faqHeader: { sectionLabel: 'FAQ', title: 'Frequently Asked Questions' }
    }
  },

  'how-it-works': {
    pageName: 'How it Works (Booking)',
    sections: {
      hero: {
        title: 'Book Your Spiritual Session with Ease',
        subtitle: 'Connect with verified spiritual advisors in just a few simple steps. Get the guidance you need, whenever you need it.',
        ctaPrimary: { label: 'Find an Advisor', href: '/advisors' },
        ctaSecondary: { label: 'Browse Categories', href: '/advisors' }
      },
      bookingSteps: {
        title: 'How Booking Works',
        subtitle: 'Five simple steps to connect with spiritual guidance',
        steps: [
          { icon: 'search', title: 'Browse Advisors', description: 'Explore verified advisors by specialty, rating, and availability' },
          { icon: 'video', title: 'Choose Session Type', description: 'Select chat, voice, or video based on your preference' },
          { icon: 'calendar', title: 'Select Time', description: 'Pick an instant session or schedule for later' },
          { icon: 'card', title: 'Confirm Payment', description: 'Secure payment processing with transparent pricing' },
          { icon: 'check', title: 'Join Session', description: 'Get notified and connect at your scheduled time' }
        ]
      },
      sessionTypes: {
        title: 'Choose Your Session Type',
        subtitle: 'Select the communication style that feels right for your journey',
        types: [
          {
            name: 'Chat Session',
            icon: 'chat',
            description: 'Text-based spiritual guidance for those who prefer writing and reflection.',
            bullets: ['Real-time messaging', 'Save conversation history', 'Share images and documents', 'Most affordable option'],
            startingPrice: 'Starting at $1.00/min',
            accentColor: 'teal'
          },
          {
            name: 'Voice Call',
            icon: 'phone',
            description: 'Personal phone consultation for deeper connection through voice.',
            bullets: ['Direct voice connection', 'Option to record session', 'More personal interaction', 'Express emotions clearly'],
            startingPrice: 'Starting at $1.50/min',
            accentColor: 'amber'
          },
          {
            name: 'Video Consultation',
            icon: 'video',
            description: 'Face-to-face spiritual guidance for the most immersive experience.',
            bullets: ['See your advisor in real-time', 'Full visual connection', 'Read body language & energy', 'Premium experience'],
            startingPrice: 'Starting at $1.80/min',
            accentColor: 'violet'
          }
        ]
      },
      schedulingMadeSimple: {
        title: 'Scheduling Made Simple',
        cards: [
          { icon: 'globe', title: 'Timezone Handling', description: 'Text-based spiritual guidance for those who prefer writing and reflection.' },
          { icon: 'bolt', title: 'Instant Sessions', description: 'Connect immediately with advisors showing "Available Now" status. No waiting required.' },
          { icon: 'calendar', title: 'Scheduled Bookings', description: 'Book sessions in advance and choose a time that works perfectly for your schedule.' },
          { icon: 'bell', title: 'Smart Reminders', description: "Receive email and app notifications before your session so you're always prepared." }
        ]
      },
      cancellationPolicy: {
        eyebrow: '',
        title: 'Fair Resolution Process',
        subtitle: "If you experience any issues, we're here to help make things right",
        sectionTitle: 'Cancellation & Reschedule Policy',
        rules: [
          { title: 'Free Rescheduling', description: 'Reschedule your appointment up to 24 hours before the scheduled time without any fees. Simply log into your account and adjust your booking.' },
          { title: 'Cancellation Terms', description: 'Cancel up to 24 hours in advance for a full refund. Cancellations made within 24 hours of the session may incur a partial fee to compensate the advisor\'s reserved time.' },
          { title: 'Advisor-Initiated Changes', description: 'If an advisor needs to cancel or reschedule, you\'ll be notified immediately and offered a full refund or the option to rebook with the same or different advisor at no extra cost.' },
          { title: 'Instant Session Flexibility', description: 'Instant sessions can be ended at any time, and you\'re only charged for the minutes used. There\'s no minimum duration required.' }
        ]
      },
      cta: {
        title: 'Ready to Begin Your Journey?',
        subtitle: 'Thousands of clients have found clarity and peace through our platform. Your spiritual guidance is just a click away.',
        buttonPrimary: { label: 'Browse Advisors Now', href: '/advisors' }
      }
    }
  },

  advisors: {
    pageName: 'Advisors List',
    sections: {
      hero: {
        eyebrow: 'OUR ADVISORS',
        title: 'Find Your Trusted Spiritual Advisor',
        subtitle: 'Browse verified advisors by specialty, language, rating, and availability.'
      },
      listSettings: { viewAllLabel: 'View All Advisors', emptyStateText: 'No advisors match those filters yet.' }
    }
  },

  'advisor-detail': {
    pageName: 'Advisor Detail',
    sections: {
      labels: {
        goBack: 'Go Back',
        aboutMe: 'About me',
        expertiseCategories: 'Expertise & Categories',
        skills: 'Skills/Expertise',
        styles: 'Styles',
        languages: 'Languages',
        weeklySchedule: 'Weekly Schedule',
        introVideo: 'Intro video',
        pricing: 'Pricing',
        bookSession: 'Book a session',
        sendMessage: 'Send message',
        reviewsAndRatings: 'Reviews & Ratings',
        averageRating: 'Average Rating',
        performanceHighlights: 'Performance Highlights'
      }
    }
  },

  'join-as-advisor': {
    pageName: 'Join as Advisor',
    sections: {
      hero: {
        title: 'Join Our Team',
        subtitle: 'Share your spiritual gifts with those seeking guidance worldwide',
        ctaPrimary: { label: 'Apply Now', href: '/join-as-advisor/apply' }
      },
      joiningProcess: {
        sectionLabel: 'How Can we Join Our Team',
        title: 'The Joining Process',
        subtitle: 'Get started in minutes and connect with spiritual guidance whenever you need it',
        steps: [
          { icon: 'doc', title: 'Application', description: 'Submit your application with your background, experience, and areas of spiritual gifting.' },
          { icon: 'video', title: 'Pre-recorded Interview', description: 'Record a video introducing yourself and demonstrating your spiritual gifts.' },
          { icon: 'monitor', title: 'Live Interview', description: 'Join a live one-on-one interview discussion about your calling and approach.' },
          { icon: 'doc-signed', title: 'Contract Signed', description: 'Review and sign your advisor agreement to join our platform.' },
          { icon: 'check', title: 'Onboarding & Activation', description: 'Complete training and set up your profile to start accepting clients.' }
        ]
      },
      application: {
        stepLabel: 'Step 1',
        title: 'Submit Your Application',
        description: 'The journey begins with a comprehensive application where you share your spiritual background, experience, and areas of gifting. We want to know your story, your calling, and how you\'ve helped others on their spiritual journey.',
        bullets: ['Personal background', 'Years of experience', 'Areas of spiritual gifting', 'Written testimony'],
        image: '',
        ctaPrimary: { label: 'Apply & Join With Our Team', href: '/join-as-advisor/apply' }
      },
      interview: {
        stepLabel: 'Steps 2 & 3',
        title: 'Interview Process',
        description: "First, you'll record a video introduction showcasing your personality and spiritual gifts. This helps us understand how you communicate and connect with others. Then, you'll have a live one-on-one interview with our team to discuss your approach, values, and how you can best serve our community. We're looking for authentic, compassionate advisors who genuinely care about helping others in their spiritual journey. This is your opportunity to shine and show us why you're the perfect fit.",
        image: '',
        ctaPrimary: { label: 'Join Our Team', href: '/join-as-advisor/apply' }
      },
      contractOnboarding: {
        stepLabel: 'Steps 4 & 5',
        title: 'Contract & Onboarding',
        description: "Once approved, you'll review and sign your advisor agreement. We'll then guide you through our comprehensive onboarding process, which includes platform training, best practices for spiritual sessions, and setting up your profile for maximum impact. Our support team is with you every step of the way, ensuring you have everything you need to succeed and make a meaningful difference in people's lives.",
        image: '',
        ctaPrimary: { label: 'Apply Now to Become an Advisor', href: '/join-as-advisor/apply' }
      },
      reachStats: {
        eyebrow: 'Try Our Application',
        title: 'Your Guidance Can Reach the World',
        subtitle: 'Join a growing global platform where spiritual advisors connect with people seeking clarity, healing, and direction. From meaningful one-on-one conversations to life-changing guidance, your voice has the power to impact lives across cultures, countries, and time zones.',
        image: '',
        items: [
          { value: '50+', label: 'Countries' },
          { value: '24/7', label: 'Availability' },
          { value: '100+', label: 'Active Users' },
          { value: '4.9★', label: 'Avg Rating' }
        ]
      },
      whyJoin: {
        sectionLabel: 'Why Prophetic pathway',
        title: 'Why Join Our Platform?',
        subtitle: 'We provide the tools, clients, and support you need to thrive',
        cards: [
          { icon: 'wallet', title: 'Weekly Payouts', description: 'Get paid weekly via direct deposit. Earn competitive rates based on your experience and ratings.' },
          { icon: 'calendar', title: 'Flexible Schedule', description: 'Set your own hours and availability. Work as much or as little as you want.' },
          { icon: 'users', title: 'Clients Provided', description: 'We handle client acquisition and matching. Focus on what you do best — providing guidance.' },
          { icon: 'globe', title: 'Global Reach', description: 'Connect with clients worldwide. Make an impact beyond geographical boundaries.' }
        ]
      },
      requirements: {
        title: 'Advisor Requirements',
        bullets: [
          'Must be 18 years or older',
          'Proven experience in spiritual guidance, counseling, or ministry',
          'Comfortable with chat, voice, and video communication',
          'Willingness to undergo background verification',
          'Strong and reliable internet connection',
          'Ability to commit to minimum weekly hours',
          'Professional communication skills',
          'Access to a quiet, professional environment for sessions'
        ],
        image: ''
      },
      advisorTestimonials: {
        sectionLabel: 'Testimonial',
        title: 'Hear from Our Advisors',
        videos: [
          { name: 'Sarah Mitchell', videoUrl: '', thumbnail: '' },
          { name: 'David Chen', videoUrl: '', thumbnail: '' },
          { name: 'Sarah Mitchell', videoUrl: '', thumbnail: '' }
        ]
      },
      beforeYouApply: {
        eyebrow: '',
        title: 'Before You Apply',
        body: "Please review our Advisors' Ethical Standards to understand the professional guidelines and expectations for all advisors on our platform. These standards ensure the highest quality of spiritual guidance and client safety.",
        ctaPrimary: { label: 'Advisors\' Ethical Standards', href: '/join-as-advisor/ethical-standards' },
        footnote: 'You will be required to agree to these standards during the application process'
      }
    }
  },

  'ethical-standards': {
    pageName: 'Ethical Standards',
    sections: {
      hero: {
        badge: 'Standards',
        title: "Advisors' Ethical Standards",
        subtitle: 'Clear expectations and professional guidelines for every advisor on our platform. These standards ensure the highest quality of spiritual guidance and client safety.',
        banner: 'All advisors are required to read, understand, and agree to these standards before joining our platform.'
      },
      standards: [
        { icon: 'shield-check', title: 'Respectful Behavior', description: 'No harassment, discrimination, manipulation, or abusive language is tolerated.' },
        { icon: 'shield-check', title: 'Accurate Profile Information', description: 'Advisors must provide truthful information about experience, skills, and specialties.' },
        { icon: 'shield-check', title: 'Platform Compliance', description: 'Violation of platform standards may lead to suspension or permanent removal.' },
        { icon: 'shield-check', title: 'Professional Communication', description: 'Advisors must communicate respectfully and professionally at all times.' },
        { icon: 'shield-check', title: 'Privacy & Confidentiality', description: 'Client conversations and personal information must remain strictly private.' },
        { icon: 'shield-check', title: 'Honest Guidance', description: 'Advisors cannot make false promises or guarantee specific outcomes.' }
      ],
      commitment: {
        eyebrow: '',
        title: 'Our Commitment to You',
        body: 'We are dedicated to maintaining the highest standards of spiritual guidance and client care. These ethical guidelines ensure that every interaction on our platform is safe, respectful, and meaningful. Advisors who violate these standards face immediate review and potential removal from the platform.\n\nIf you experience any behavior that violates these standards, please report it immediately. Your safety and well-being are our top priorities.',
        ctaPrimary: { label: 'Continue to Application', href: '/join-as-advisor/apply' },
        ctaSecondary: { label: 'Report a Concern', href: '/contact' }
      }
    }
  },

  reviews: {
    pageName: 'Reviews / Satisfaction',
    sections: {
      hero: {
        badge: 'Satisfaction',
        title: 'Your Experience Matters to Us',
        subtitle: "We're committed to providing a safe, trustworthy, and transformative spiritual guidance experience. Your satisfaction and well-being are our top priorities."
      },
      commitment: {
        title: 'Our Commitment to You',
        cards: [
          {
            icon: 'shield-check',
            title: 'Trusted Advisors',
            description: 'Every advisor undergoes rigorous verification, background checks, and skill assessments before joining our platform.',
            bullets: ['Multi-step vetting process', 'Continuous performance monitoring', 'Real client reviews and ratings', 'Ethical standards compliance']
          },
          {
            icon: 'lock',
            title: 'Secure & Private Sessions',
            description: 'Your spiritual journey is confidential. All communications are encrypted and protected.',
            bullets: ['End-to-end encryption', 'No data sharing with third parties', 'Secure payment processing', 'Private session recordings']
          },
          {
            icon: 'users',
            title: 'Customer Support',
            description: 'Our dedicated support team is available to help resolve any issues or concerns you may have.',
            bullets: ['24/7 email support', 'Live chat during business hours', 'Quick response time', 'Dedicated resolution team']
          },
          {
            icon: 'heart',
            title: 'Satisfaction Commitment',
            description: 'We review concerns fairly and work to ensure every client has a positive experience.',
            bullets: ['Fair dispute resolution process', 'Client feedback valued', 'Continuous improvement', 'Transparent communication']
          }
        ]
      },
      trustedByThousands: {
        title: 'Trusted by Thousands',
        stats: [
          { value: '50,000+', label: 'Sessions Completed' },
          { value: '4.8/5', label: 'Average Rating' },
          { value: '10,000+', label: 'Active Users' },
          { value: '98%', label: 'Satisfaction Rate' }
        ]
      },
      fairResolution: {
        title: 'Fair Resolution Process',
        subtitle: "If you experience any issues, we're here to help make things right",
        steps: [
          { icon: '1', title: 'Report the Issue', description: 'Contact our support team within 24 hours of the session via email, chat, or phone. Provide details about what went wrong and how we can help.' },
          { icon: '2', title: 'Review Process', description: 'Our team will review your case, including session records (if available) and communications. We may reach out for additional information to ensure a fair assessment.' },
          { icon: '3', title: 'Resolution Options', description: 'Based on our review, we\'ll offer appropriate solutions which may include: end-to-end encryption, no data sharing with third parties, secure payment processing, private session recordings.' }
        ],
        importantNote: 'Important to Note: While we strive for complete satisfaction, refunds are evaluated on a case-by-case basis. We cannot guarantee refunds for subjective dissatisfaction with spiritual guidance, as interpretations and approaches vary. However, we always work to find a fair resolution for legitimate concerns including technical issues, advisor misconduct, or service failures.'
      },
      testimonialsHeader: {
        eyebrow: 'Reviews',
        title: 'What Our Customers Say',
        subtitle: 'Thousands of people find clarity, comfort, and guidance every day on Prophetic pathway',
        trustpilotRating: '4.8 Out of 5',
        totalReviews: '56,714 reviews'
      },
      contactBlock: {
        title: 'Have Questions or Concerns?',
        subtitle: 'Our support team is here to help. Whether you have questions before booking or need assistance with an existing session, we\'re just a message away.',
        ctaPrimary: { label: 'Contact Support', href: '/contact' },
        contactEmail: 'support@spiritpath.com',
        contactPhone: '1-800-SPIRIT-1'
      }
    }
  },

  blogs: {
    pageName: 'Blogs',
    sections: {
      hero: {
        eyebrow: 'Blogs & Articles',
        title: 'Spiritual Insights & Guidance',
        subtitle: 'Explore articles on spiritual growth, dream interpretation, prayer, and finding your path',
        searchPlaceholder: 'Search articles...'
      },
      categories: [
        'All',
        'Love & Relationship',
        'Dream Interpretation',
        'Career',
        'Deliverance',
        'family',
        'marriage',
        'finances'
      ],
      newsletterCta: {
        title: 'Get Spiritual Insights Delivered',
        subtitle: 'Subscribe to receive our latest articles, spiritual guidance, and exclusive content directly to your inbox.',
        placeholder: 'Enter your email',
        buttonLabel: 'Subscribe'
      }
    }
  },

  about: {
    pageName: 'About',
    sections: {
      hero: {
        title: 'Helping People Find Clarity, Direction & Spiritual Guidance',
        subtitle: 'At Prophetic Pathway, we believe everyone deserves access to trusted spiritual guidance in moments when life feels uncertain. Our platform connects people with experienced prophetic advisors through secure chat, voice, and video sessions designed to bring encouragement, wisdom, and peace of mind.'
      },
      story: {
        title: 'Our Story',
        paragraphs: [
          'What started as a vision to create a safe and accessible space for spiritual guidance has grown into a global platform connecting seekers with compassionate advisors from different backgrounds and areas of gifting.',
          'We noticed that many people searching for spiritual clarity often struggled to find trustworthy, professional, and accessible prophetic support online. Existing experiences felt confusing, inconsistent, or lacked genuine human connection.',
          'Prophetic Pathway was created to change that.',
          'Our mission is simple: to build a trusted environment where people can receive spiritual guidance in a way that feels personal, respectful, secure, and meaningful.',
          'Whether someone is seeking direction, encouragement, prayer, emotional support, or spiritual insight, our goal is to make that connection accessible anytime, anywhere.'
        ]
      },
      values: {
        title: 'Our Values',
        cards: [
          { icon: 'shield-check', title: 'Authentic Guidance', description: 'We value honesty, compassion, and meaningful spiritual connection in every interaction.' },
          { icon: 'lock', title: 'Trust & Privacy', description: 'All sessions are handled with confidentiality and respect to create a safe environment for every user.' },
          { icon: 'users', title: 'Human Connection', description: 'Technology supports the experience, but genuine human care remains at the center of our platform.' },
          { icon: 'globe', title: 'Accessibility', description: 'We make spiritual guidance available globally through flexible chat, audio, and video sessions.' }
        ]
      },
      howItWorks: {
        sectionLabel: 'Simple Process',
        title: 'How Prophetic pathway Works',
        subtitle: 'Get started in minutes and connect with spiritual guidance whenever you need it',
        steps: [
          { icon: 'user', title: 'Choose Your Advisor', description: 'Browse verified spiritual advisors and find your perfect match based on reviews, expertise, and availability.' },
          { icon: 'video', title: 'Start Your Session', description: 'Connect instantly via chat, voice, or video. Pay per minute, end any time. Get a full transcript and recording after the session.' },
          { icon: 'card', title: 'Pay Per Minute', description: 'Transparent pricing with no hidden fees. Only pay for the time you use with flexible wallet and subscription options.' },
          { icon: 'star', title: 'Get Clarity', description: 'Receive guidance, insights, and spiritual support. All sessions can be recorded and transcribed for your reference.' }
        ]
      },
      whyChoose: {
        sectionLabel: 'Why Prophetic pathway',
        title: 'Find Clarity, Comfort, and Real Human Connection',
        subtitle: "Connect with trusted spiritual advisors who are here to listen, guide, and support you through life's most personal moments.",
        cards: [
          { icon: 'shield-check', title: 'Trusted & Verified Advisors', description: 'Every advisor goes through a detailed approval and interview process.' },
          { icon: 'chat', title: 'Instant Chat, Voice & Video Sessions', description: 'Connect the way you feel most comfortable.' },
          { icon: 'lock', title: 'Safe & Confidential Experience', description: 'Your sessions stay private and secure.' },
          { icon: 'compass', title: 'Personalized Spiritual Guidance', description: 'Receive support tailored to your unique situation.' },
          { icon: 'globe', title: 'Available Anytime You Need Support', description: 'Our global advisor network is available across multiple time zones.' },
          { icon: 'star', title: 'Real Reviews From Real People', description: 'Explore genuine experiences and trusted ratings.' }
        ]
      },
      cta: {
        title: 'Start Your Spiritual Journey Today',
        subtitle: 'Connect with trusted advisors anytime through secure and meaningful conversations',
        buttonPrimary: { label: 'Find an Advisor', href: '/advisors' },
        buttonSecondary: { label: 'Get Started', href: '/advisors' }
      }
    }
  },

  contact: {
    pageName: 'Contact',
    sections: {
      hero: {
        title: 'Get in Touch',
        subtitle: "Have questions or need support? We're here to help. Reach out to our team and we'll get back to you as soon as possible."
      },
      contactInfo: {
        title: 'Contact Information',
        email: 'support@spiritpath.com',
        emailLabel: 'For general inquiries',
        phone: '1-800-SPIRIT-1',
        phoneLabel: 'Mon-Fri, 9AM-6PM EST',
        office: '123 Spiritual Way\nSan Francisco, CA 94102',
        officeLabel: 'Office',
        businessHours: [
          'Monday - Friday: 9AM - 6PM',
          'Saturday: 10AM - 4PM',
          'Sunday: Closed'
        ]
      },
      quickHelp: {
        title: 'Quick Help',
        body: 'Looking for immediate assistance? Check out our Help Center for FAQs and guides.',
        ctaPrimary: { label: 'Visit Help Center', href: '/blogs' }
      },
      formSettings: {
        title: 'Send Us a Message',
        subtitle: 'We typically respond within 24-48 hours during business days.',
        categories: ['General Inquiry', 'Technical Support', 'Billing Question', 'Advisor Application', 'Report an issue', 'Others'],
        successMessage: 'Thanks! Your message was sent. We\'ll be in touch within 24-48 hours.'
      }
    }
  }
};

export const seedSiteContent = async () => {
  let created = 0;
  for (const [pageSlug, { pageName, sections }] of Object.entries(DEFAULTS)) {
    const result = await SiteContent.findOneAndUpdate(
      { pageSlug },
      { $setOnInsert: { pageSlug, pageName, sections } },
      { upsert: true, new: false, rawResult: true }
    );
    if (!result.lastErrorObject?.updatedExisting) created += 1;
  }
  if (created > 0) console.log(`✓ Seeded ${created} site-content page(s)`);
  else console.log('✓ Site content already seeded');
};

// Allow `node scripts/seed-site-content.js` invocation
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const dotenv = await import('dotenv');
  dotenv.config();
  const connectDB = (await import('../config/db.js')).default;
  await connectDB();
  await seedSiteContent();
  process.exit(0);
}

export default seedSiteContent;
