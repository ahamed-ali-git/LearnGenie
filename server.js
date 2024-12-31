import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import youtubedl from "yt-dlp-exec";
import { OpenAI } from "openai";
import fs from "fs/promises";

// Initialize environment variables
env.config();
const port = process.env.PORT || 3000;
const saltRounds = 10;

// Database connection setup
const { Client } = pg;
const db = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});
db.connect()
  .then(() => console.log("Connected to the database"))
  .catch((err) => console.error("Database connection error:", err));

// Resolve file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize the Express app
const app = express();

// Middleware setup
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "default_secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");


// Passport configuration
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      // Replace with actual user verification logic from database
      const user = {
        id: 1,
        username,
        passwordHash: await bcrypt.hash("password", 10),
      }; // Example user
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (isMatch) return done(null, user);
      return done(null, false, { message: "Invalid credentials" });
    } catch (err) {
      return done(err);
    }
  })
);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    (accessToken, refreshToken, profile, done) => {
      // Replace with actual user logic
      return done(null, profile);
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => done(null, { id })); // Replace with user fetch logic

// Helper Functions

// Add this helper function at the top of your file
function getVideoId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Add this function to extract keywords from summary points
function extractKeywords(points) {
    // Remove common words and get important keywords
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
    const keywords = points
        .join(' ')
        .toLowerCase()
        .split(/\W+/)
        .filter(word => 
            word.length > 3 && 
            !commonWords.has(word)
        );
    
    // Count keyword frequency
    const keywordCount = {};
    keywords.forEach(word => {
        keywordCount[word] = (keywordCount[word] || 0) + 1;
    });

    // Sort by frequency and get top keywords
    return Object.entries(keywordCount)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([word]) => word);
}

// Modify the simpleSummarize function
function simpleSummarize(text, maxLength = 2000) {
  // More thorough text cleaning
  text = text
      .replace(/[^\w\s.,!?]/g, ' ') // Remove all special characters except basic punctuation
      .replace(/\bemoji\b|\bsticker\b/gi, '') // Remove emoji/sticker references
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\d+/g, '') // Remove numbers
      .trim();

  // Professional intro phrases
  const intros = [
      "The video explains in detail",
      "A comprehensive overview shows",
      "The content thoroughly covers",
      "An in depth analysis reveals",
      "The presentation demonstrates",
      "The tutorial explores",
      "A detailed examination shows",
      "The video provides insight into",
      "A thorough explanation covers",
      "The content effectively illustrates",
      "The discussion elaborates on",
      "An important aspect reveals",
      "The video delves into",
      "A key highlight discusses",
      "The analysis demonstrates"
  ];

  // Function to shuffle array
  function shuffleArray(array) {
      for (let i = array.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
  }

  // Shuffle the intros array
  const shuffledIntros = shuffleArray([...intros]);

  // Split into sentences and clean them
  const sentences = text.split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => {
          return s.length > 15 && // Allow slightly shorter sentences
              !s.toLowerCase().includes('subscribe') &&
              !s.toLowerCase().includes('follow') &&
              !s.toLowerCase().includes('link') &&
              !s.toLowerCase().includes('comment');
      });

  // Generate points with random intros
  let points = [];
  let usedSentences = new Set();

  for (let sentence of sentences) {
      if (points.length >= 10) break;
      
      if (!usedSentences.has(sentence)) {
          let cleanSentence = sentence
              .trim()
              .replace(/^[^a-zA-Z]+/, '')
              .toLowerCase();

          // Get random intro
          const randomIntro = shuffledIntros[Math.floor(Math.random() * shuffledIntros.length)];
          let point = `${randomIntro} ${cleanSentence}`;
          point = point.charAt(0).toUpperCase() + point.slice(1);
          if (!point.endsWith('.')) point += '.';

          points.push(point);
          usedSentences.add(sentence);
      }
  }

  // If we still need more points, generate them with random intros
  while (points.length < 10 && sentences.length > 0) {
      let baseSentence = sentences[points.length % sentences.length];
      const randomIntro = shuffledIntros[Math.floor(Math.random() * shuffledIntros.length)];
      let point = `${randomIntro} ${baseSentence.toLowerCase()}`;
      point = point.charAt(0).toUpperCase() + point.slice(1);
      if (!point.endsWith('.')) point += '.';
      points.push(point);
  }

  // Generate quiz questions from the points
  function generateQuizQuestion(point) {
      // Remove the intro phrase to get the actual content
      const content = point.split(' ').slice(3).join(' ');
      
      return {
          question: content,
          options: [
              "True",
              "False"
          ],
          correctAnswer: "True" // Since these are factual statements from the video
      };
  }

  // Generate quiz questions from the points
  const quizQuestions = points.map(generateQuizQuestion);

  // Extract keywords from the points
  const keywords = extractKeywords(points);

  // Generate mock related videos based on keywords
  const relatedVideos = generateMockRelatedVideos(keywords);

  // Format with HTML for larger display
  let summary = `
  <div class="ai-summary" style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto;">
      <h2 style="color: #1a202c; margin-bottom: 35px; font-size: 28px; text-align: center;">
          Video Content Analysis
      </h2>
      <div class="summary-points" style="font-size: 20px; line-height: 2;">`;
  
  points.forEach((point, index) => {
      summary += `
          <div class="summary-point" style="margin-bottom: 30px; padding: 20px; background-color: #f8fafc; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
              <span style="color: #3730a3; font-weight: 600; margin-right: 15px; font-size: 22px;">
                  ${index + 1}.
              </span>
              <span style="color: #2d3748;">
                  ${point}
              </span>
          </div>`;
  });

  summary += `</div>
      <div class="keywords-data" style="display: none;" data-keywords='${JSON.stringify(keywords)}'></div>
      <div class="related-videos-data" style="display: none;" data-videos='${JSON.stringify(relatedVideos)}'></div>
      <div class="quiz-data" style="display: none;" data-quiz='${JSON.stringify(quizQuestions)}'>
      </div>
  </div>`;
  
  return summary;
}

// Add this function to generate mock related videos
function generateMockRelatedVideos(keywords) {
    const videoTemplates = [
        {
            title: "Complete Guide to {keyword}",
            description: "Learn everything about {keyword} in this comprehensive tutorial."
        },
        {
            title: "Understanding {keyword} - Deep Dive",
            description: "An in-depth exploration of {keyword} concepts."
        },
        {
            title: "{keyword} Masterclass",
            description: "Master the fundamentals of {keyword} with practical examples."
        },
        {
            title: "{keyword} Tips and Tricks",
            description: "Essential tips for working with {keyword}."
        },
        {
            title: "Advanced {keyword} Techniques",
            description: "Take your {keyword} skills to the next level."
        }
    ];

    const relatedVideos = [];
    keywords.forEach(keyword => {
        const template = videoTemplates[Math.floor(Math.random() * videoTemplates.length)];
        relatedVideos.push({
            id: Math.random().toString(36).substr(2, 9),
            title: template.title.replace('{keyword}', keyword),
            description: template.description.replace('{keyword}', keyword),
            thumbnail: `/api/placeholder/300/180?text=${encodeURIComponent(keyword)}`,
            publishedAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString()
        });
    });

    return relatedVideos;
}

// Authentication middleware
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect("/login");
}
  

// Routes
app.get("/", (req, res) => res.redirect("/register"));
app.get("/login", (req, res) => res.render("login", { title: "Login" }));
app.get("/register", (req, res) => res.render("register", { title: "Register" }));
app.get("/home", ensureAuthenticated, (req, res) =>
  res.render("home", { user: req.user, title: "Home" })
);

// Routes
app.get("/", (req, res) => {
    res.render("register");  // This assumes the register.ejs file is in the 'views' directory
  });

app.get("/video", ensureAuthenticated, (req, res) => {
  res.render("video", { user: req.user, title: "videos" });
});

app.get("/flash", ensureAuthenticated, (req, res) => {
  const flashcardPoints = req.session.flashcardPoints || [];
  res.render("flash", { 
    user: req.user, 
    title: "flash",
    flashcardPoints: flashcardPoints 
  });
});

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["email", "profile"] })
);

app.get(
  "/auth/google/home",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    res.redirect("/home");
  }
);

// Signup route
app.post("/api/signup", async (req, res) => {
  const { fullName, email, password } = req.body;
  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    await db.query(
      "INSERT INTO users (full_name, email, password) VALUES ($1, $2, $3)",
      [fullName, email, hashedPassword]
    );
    res.status(201).json({ success: true, message: "Account created successfully" });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Error creating account" });
  }
});

// Login route
app.post(
  "/api/login",
  passport.authenticate("local", { failureRedirect: "/login" }),
  (req, res) => {
    const redirectTo = req.session.returnTo || "/home";
    delete req.session.returnTo;
    res.json({ success: true, message: "Login successful", redirect: redirectTo });
  }
);

// Logout route
app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).send("Error during logout");
    }
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destruction error:", err);
        return res.status(500).send("Error destroying session");
      }
      res.clearCookie("connect.sid");
      res.redirect("/login"); // Redirect to the login page after logout
    });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error occurred:", err);
  res.status(500).send("Something broke!");
});

// Example YouTube downloader route
app.get("/download", async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).send("Video URL is required");
  }
  try {
    const output = await youtubedl(videoUrl, { output: "video.mp4" });
    res.send("Download successful");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Example OpenAI API usage route
app.get("/openai", async (req, res) => {
  const openai = new OpenAI(process.env.OPENAI_API_KEY);
  try {
    const response = await openai.completions.create({
      model: "text-davinci-003",
      prompt: "Hello, OpenAI!",
      max_tokens: 10,
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Example static file serving route
app.get("/static", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Example route to summarize a text
app.post('/api/summarize', async (req, res) => {
  try {
      const { url } = req.body;
      console.log('Processing URL:', url);

      // First try to get video info including subtitles
      const videoInfo = await youtubedl(url, {
          dumpSingleJson: true,
          writeAutoSub: true,
          subLang: 'en',
          noCheckCertificates: true,
          noWarnings: true,
          preferFreeFormats: true
      });

      // Try to get subtitles first
      let textContent = '';
      try {
          // Try to get auto-generated subtitles
          const subtitlesResult = await youtubedl(url, {
              skipDownload: true,
              writeAutoSub: true,
              subFormat: 'srt',
              output: path.join(__dirname, 'temp/%(id)s.%(ext)s')
          });

          // Read the subtitle file if it exists
          const subtitlePath = path.join(__dirname, `temp/${videoInfo.id}.en.srt`);
          if (await fs.access(subtitlePath).then(() => true).catch(() => false)) {
              textContent = await fs.readFile(subtitlePath, 'utf8');
              // Clean up subtitle formatting
              textContent = textContent.replace(/\d+\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/g, '');
              textContent = textContent.replace(/\n\n/g, ' ');
              await fs.unlink(subtitlePath); // Clean up the file
          }
      } catch (error) {
          console.log('Error getting subtitles:', error);
      }

      // If no subtitles, use description and other metadata
      if (!textContent) {
          textContent = [
              videoInfo.title,
              videoInfo.description,
              videoInfo.tags?.join(', '),
              videoInfo.categories?.join(', ')
          ].filter(Boolean).join('\n\n');
      }

      // Generate summary
      const summary = simpleSummarize(textContent, 2000);

      res.json({
          success: true,
          data: {
              videoTitle: videoInfo.title,
              channelName: videoInfo.channel,
              duration: videoInfo.duration,
              thumbnail: videoInfo.thumbnail,
              summary: summary || 'No summary available. Try another video.'
          }
      });

  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({
          success: false,
          error: error.message || 'Error processing video'
      });
  }
});

// Add this near your other routes
app.post('/api/create-flashcards', (req, res) => {
    const { points } = req.body;
    
    // Store points in session for use in flash page
    req.session.flashcardPoints = points;
    
    res.json({ success: true });
});

app.get("/quiz", ensureAuthenticated, (req, res) => {
    const questions = req.session.quizQuestions || [];
    res.render("quiz", { 
        user: req.user, 
        title: "quiz",
        questions: questions 
    });
});

app.post('/api/create-quiz', (req, res) => {
    const { questions } = req.body;
    req.session.quizQuestions = questions;
    res.json({ success: true });
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});