import { z } from 'zod';
import { SITE_CONTENT_SLUGS } from '../models/siteContent.model.js';

/**
 * Per-page section shape definitions.
 *
 * Philosophy: shapes describe the "happy path" structure the website expects.
 * Every leaf field is `.optional()` so admins can clear text or postpone
 * filling something without the PUT being rejected. The shape is enforced
 * (no rogue keys via `.strict()`) so a typo in the admin form fails fast
 * instead of silently being ignored at render time.
 */

const link = z
  .object({
    label: z.string().optional(),
    href: z.string().optional()
  })
  .strict()
  .optional();

const image = z.string().optional(); // Cloudinary URL string
const richText = z.string().optional();

const heroBase = z
  .object({
    badge: z.string().optional(),
    title: z.string().optional(),
    highlightedWord: z.string().optional(),
    subtitle: z.string().optional(),
    backgroundImage: image,
    ctaPrimary: link,
    ctaSecondary: link
  })
  .strict()
  .optional();

const card = z
  .object({
    icon: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    image: image,
    href: z.string().optional()
  })
  .strict();

const step = z
  .object({
    icon: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional()
  })
  .strict();

const statItem = z
  .object({
    value: z.string().optional(),
    label: z.string().optional()
  })
  .strict();

const ctaBlock = z
  .object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    buttonPrimary: link,
    buttonSecondary: link,
    backgroundImage: image
  })
  .strict()
  .optional();

// ===== Per-page =====

const globalSections = z
  .object({
    siteName: z.string().optional(),
    logo: image,
    logoDark: image,
    nav: z.array(z.object({ label: z.string(), href: z.string() }).strict()).optional(),
    auth: z
      .object({
        loginLabel: z.string().optional(),
        signupLabel: z.string().optional()
      })
      .strict()
      .optional(),
    footer: z
      .object({
        tagline: z.string().optional(),
        columns: z
          .array(
            z
              .object({
                title: z.string().optional(),
                links: z.array(z.object({ label: z.string(), href: z.string() }).strict()).optional()
              })
              .strict()
          )
          .optional(),
        socialLinks: z
          .array(
            z
              .object({
                platform: z.string().optional(),
                href: z.string().optional()
              })
              .strict()
          )
          .optional(),
        appStoreLink: z.string().optional(),
        playStoreLink: z.string().optional(),
        copyright: z.string().optional(),
        contact: z
          .object({
            email: z.string().optional(),
            phone: z.string().optional(),
            address: z.string().optional()
          })
          .strict()
          .optional()
      })
      .strict()
      .optional()
  })
  .strict();

const homeSections = z
  .object({
    hero: heroBase,
    howItWorks: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        steps: z.array(step).optional()
      })
      .strict()
      .optional(),
    watchInAction: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        videoUrl: z.string().optional(),
        posterImage: image
      })
      .strict()
      .optional(),
    featuredAdvisorsHeader: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        viewAllLabel: z.string().optional()
      })
      .strict()
      .optional(),
    whyChoose: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        cards: z.array(card).optional()
      })
      .strict()
      .optional(),
    appPromo: z
      .object({
        eyebrow: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        features: z.array(z.string()).optional(),
        appStoreLink: z.string().optional(),
        playStoreLink: z.string().optional(),
        screenshotImages: z.array(image).optional()
      })
      .strict()
      .optional(),
    testimonialsHeader: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        trustpilotRating: z.string().optional(),
        totalReviews: z.string().optional()
      })
      .strict()
      .optional(),
    cta: ctaBlock,
    faqHeader: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const joinAsAdvisorSections = z
  .object({
    hero: heroBase,
    joiningProcess: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        steps: z.array(step).optional()
      })
      .strict()
      .optional(),
    application: z
      .object({
        stepLabel: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        bullets: z.array(z.string()).optional(),
        image: image,
        ctaPrimary: link
      })
      .strict()
      .optional(),
    interview: z
      .object({
        stepLabel: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        image: image,
        ctaPrimary: link
      })
      .strict()
      .optional(),
    contractOnboarding: z
      .object({
        stepLabel: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        image: image,
        ctaPrimary: link
      })
      .strict()
      .optional(),
    reachStats: z
      .object({
        eyebrow: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        image: image,
        items: z.array(statItem).optional()
      })
      .strict()
      .optional(),
    whyJoin: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        cards: z.array(card).optional()
      })
      .strict()
      .optional(),
    requirements: z
      .object({
        title: z.string().optional(),
        bullets: z.array(z.string()).optional(),
        image: image
      })
      .strict()
      .optional(),
    advisorTestimonials: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        videos: z
          .array(
            z
              .object({
                name: z.string().optional(),
                quote: z.string().optional(),
                videoUrl: z.string().optional(),
                thumbnail: image
              })
              .strict()
          )
          .optional()
      })
      .strict()
      .optional(),
    beforeYouApply: z
      .object({
        eyebrow: z.string().optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        ctaPrimary: link,
        footnote: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const ethicalStandardsSections = z
  .object({
    hero: z
      .object({
        badge: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        banner: z.string().optional(),
        backgroundImage: image
      })
      .strict()
      .optional(),
    standards: z.array(card).optional(),
    commitment: z
      .object({
        eyebrow: z.string().optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        ctaPrimary: link,
        ctaSecondary: link
      })
      .strict()
      .optional()
  })
  .strict();

const howItWorksSections = z
  .object({
    hero: heroBase,
    bookingSteps: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        steps: z.array(step).optional()
      })
      .strict()
      .optional(),
    sessionTypes: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        types: z
          .array(
            z
              .object({
                name: z.string().optional(),
                icon: z.string().optional(),
                description: z.string().optional(),
                bullets: z.array(z.string()).optional(),
                startingPrice: z.string().optional(),
                accentColor: z.string().optional()
              })
              .strict()
          )
          .optional()
      })
      .strict()
      .optional(),
    schedulingMadeSimple: z
      .object({
        title: z.string().optional(),
        cards: z.array(card).optional()
      })
      .strict()
      .optional(),
    cancellationPolicy: z
      .object({
        eyebrow: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        sectionTitle: z.string().optional(),
        rules: z
          .array(
            z
              .object({
                title: z.string().optional(),
                description: z.string().optional()
              })
              .strict()
          )
          .optional()
      })
      .strict()
      .optional(),
    cta: ctaBlock
  })
  .strict();

const reviewsSections = z
  .object({
    hero: z
      .object({
        badge: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional()
      })
      .strict()
      .optional(),
    commitment: z
      .object({
        title: z.string().optional(),
        cards: z
          .array(
            z
              .object({
                icon: z.string().optional(),
                title: z.string().optional(),
                description: z.string().optional(),
                bullets: z.array(z.string()).optional()
              })
              .strict()
          )
          .optional()
      })
      .strict()
      .optional(),
    trustedByThousands: z
      .object({
        title: z.string().optional(),
        stats: z.array(statItem).optional()
      })
      .strict()
      .optional(),
    fairResolution: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        steps: z.array(step).optional(),
        importantNote: z.string().optional()
      })
      .strict()
      .optional(),
    testimonialsHeader: z
      .object({
        eyebrow: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        trustpilotRating: z.string().optional(),
        totalReviews: z.string().optional()
      })
      .strict()
      .optional(),
    contactBlock: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        ctaPrimary: link,
        contactEmail: z.string().optional(),
        contactPhone: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const blogsSections = z
  .object({
    hero: z
      .object({
        eyebrow: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        searchPlaceholder: z.string().optional(),
        backgroundImage: image
      })
      .strict()
      .optional(),
    categories: z.array(z.string()).optional(),
    newsletterCta: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        placeholder: z.string().optional(),
        buttonLabel: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const aboutSections = z
  .object({
    hero: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional()
      })
      .strict()
      .optional(),
    story: z
      .object({
        title: z.string().optional(),
        paragraphs: z.array(z.string()).optional()
      })
      .strict()
      .optional(),
    values: z
      .object({
        title: z.string().optional(),
        cards: z.array(card).optional()
      })
      .strict()
      .optional(),
    howItWorks: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        steps: z.array(step).optional()
      })
      .strict()
      .optional(),
    whyChoose: z
      .object({
        sectionLabel: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        cards: z.array(card).optional()
      })
      .strict()
      .optional(),
    cta: ctaBlock
  })
  .strict();

const contactSections = z
  .object({
    hero: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional()
      })
      .strict()
      .optional(),
    contactInfo: z
      .object({
        title: z.string().optional(),
        email: z.string().optional(),
        emailLabel: z.string().optional(),
        phone: z.string().optional(),
        phoneLabel: z.string().optional(),
        office: z.string().optional(),
        officeLabel: z.string().optional(),
        businessHours: z.array(z.string()).optional()
      })
      .strict()
      .optional(),
    quickHelp: z
      .object({
        title: z.string().optional(),
        body: z.string().optional(),
        ctaPrimary: link
      })
      .strict()
      .optional(),
    formSettings: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        categories: z.array(z.string()).optional(),
        successMessage: z.string().optional(),
        footnote: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const advisorsListSections = z
  .object({
    hero: z
      .object({
        eyebrow: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional()
      })
      .strict()
      .optional(),
    listSettings: z
      .object({
        viewAllLabel: z.string().optional(),
        emptyStateText: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const advisorDetailSections = z
  .object({
    labels: z
      .object({
        goBack: z.string().optional(),
        aboutMe: z.string().optional(),
        expertiseCategories: z.string().optional(),
        skills: z.string().optional(),
        styles: z.string().optional(),
        languages: z.string().optional(),
        weeklySchedule: z.string().optional(),
        introVideo: z.string().optional(),
        pricing: z.string().optional(),
        bookSession: z.string().optional(),
        sendMessage: z.string().optional(),
        reviewsAndRatings: z.string().optional(),
        averageRating: z.string().optional(),
        performanceHighlights: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const loginSections = z
  .object({
    form: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        emailPlaceholder: z.string().optional(),
        passwordPlaceholder: z.string().optional(),
        rememberLabel: z.string().optional(),
        forgotPasswordLabel: z.string().optional(),
        submitLabel: z.string().optional(),
        submittingLabel: z.string().optional(),
        signupPrompt: z.string().optional(),
        signupLinkLabel: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const signupSections = z
  .object({
    form: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        nameLabel: z.string().optional(),
        namePlaceholder: z.string().optional(),
        emailLabel: z.string().optional(),
        emailPlaceholder: z.string().optional(),
        phoneLabel: z.string().optional(),
        phonePlaceholder: z.string().optional(),
        dobLabel: z.string().optional(),
        countryLabel: z.string().optional(),
        countryPlaceholder: z.string().optional(),
        cityLabel: z.string().optional(),
        cityPlaceholder: z.string().optional(),
        stateLabel: z.string().optional(),
        statePlaceholder: z.string().optional(),
        passwordLabel: z.string().optional(),
        passwordPlaceholder: z.string().optional(),
        termsLabel: z.string().optional(),
        termsLinkLabel: z.string().optional(),
        submitLabel: z.string().optional(),
        submittingLabel: z.string().optional(),
        loginPrompt: z.string().optional(),
        loginLinkLabel: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const advisorApplicationSections = z
  .object({
    hero: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional()
      })
      .strict()
      .optional(),
    helper: z
      .object({
        lockedAccountText: z.string().optional(),
        statusPrefix: z.string().optional(),
        reviewedLockText: z.string().optional(),
        approvedMessage: z.string().optional(),
        rejectedMessage: z.string().optional()
      })
      .strict()
      .optional(),
    sections: z
      .object({
        personalTitle: z.string().optional(),
        addressTitle: z.string().optional(),
        experienceTitle: z.string().optional(),
        introVideoTitle: z.string().optional()
      })
      .strict()
      .optional(),
    fields: z
      .object({
        fullNameLabel: z.string().optional(),
        emailLabel: z.string().optional(),
        phoneLabel: z.string().optional(),
        dobLabel: z.string().optional(),
        addressLabel: z.string().optional(),
        addressPlaceholder: z.string().optional(),
        countryLabel: z.string().optional(),
        countryPlaceholder: z.string().optional(),
        stateLabel: z.string().optional(),
        statePlaceholder: z.string().optional(),
        cityLabel: z.string().optional(),
        cityPlaceholder: z.string().optional(),
        experienceLabel: z.string().optional(),
        experiencePlaceholder: z.string().optional(),
        availabilityLabel: z.string().optional(),
        baptizedLabel: z.string().optional()
      })
      .strict()
      .optional(),
    introVideo: z
      .object({
        requirementTitle: z.string().optional(),
        description: z.string().optional(),
        technicalTitle: z.string().optional(),
        questions: z.array(z.string()).optional(),
        technicalRequirements: z.array(z.string()).optional(),
        finalNote: z.string().optional(),
        uploadLabel: z.string().optional(),
        uploadPlaceholder: z.string().optional(),
        uploadHint: z.string().optional()
      })
      .strict()
      .optional(),
    consent: z
      .object({
        ethicalAgreementPrefix: z.string().optional(),
        ethicalStandardsLabel: z.string().optional(),
        ethicalAgreementSuffix: z.string().optional(),
        privacyNote: z.string().optional(),
        submitLabel: z.string().optional(),
        submittingLabel: z.string().optional(),
        lockedLabel: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const sectionSchemaForSlug = {
  global: globalSections,
  home: homeSections,
  'how-it-works': howItWorksSections,
  advisors: advisorsListSections,
  'advisor-detail': advisorDetailSections,
  login: loginSections,
  signup: signupSections,
  'join-as-advisor': joinAsAdvisorSections,
  'advisor-application': advisorApplicationSections,
  'ethical-standards': ethicalStandardsSections,
  reviews: reviewsSections,
  blogs: blogsSections,
  about: aboutSections,
  contact: contactSections
};

export const isValidSlug = (slug) => SITE_CONTENT_SLUGS.includes(slug);

/**
 * Validate (and strip unknown keys via .strict()) a sections payload for a given slug.
 * Returns parsed value; throws ZodError on shape violation.
 */
export const validateSiteContent = (slug, sections) => {
  const schema = sectionSchemaForSlug[slug];
  if (!schema) throw new Error(`Unknown site-content slug: ${slug}`);
  return schema.parse(sections || {});
};

export default { sectionSchemaForSlug, validateSiteContent, isValidSlug };
