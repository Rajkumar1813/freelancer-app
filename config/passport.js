const passport       = require('passport');
const LocalStrategy  = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt         = require('bcryptjs');
const User           = require('../models/User');

// ── Local Strategy ────────────────────────────────────────────────────────────
passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user)           return done(null, false, { message: 'Email not registered' });

    // ── NOTE: isVerified check yahan se HATAYA gaya hai ──────────────────────
    // Pehle yahan check tha:
    //   if (!user.isVerified) return done(null, false, { message: '...' });
    // Isse postLogin mein user=false aata tha aur unverified redirect nahi hota.
    // Ab postLogin khud handle karta hai unverified case ko.
    // ─────────────────────────────────────────────────────────────────────────

    if (!user.password)  return done(null, false, { message: 'Please login with Google' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)        return done(null, false, { message: 'Incorrect password' });

    // User return karo — verified/unverified dono — postLogin decide karega
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

// ── Google OAuth Strategy ─────────────────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ googleId: profile.id });
    if (!user) {
      user = await User.findOne({ email: profile.emails[0].value });
      if (user) {
        user.googleId     = profile.id;
        user.googleAvatar = profile.photos[0]?.value;
        user.isVerified   = true;
        await user.save();
      } else {
        user = await User.create({
          googleId:           profile.id,
          name:               profile.displayName,
          email:              profile.emails[0].value.toLowerCase(),
          googleAvatar:       profile.photos[0]?.value,
          isVerified:         true,
          role:               'client',
          authProvider:       'google',
          needsRoleSelection: true
        });
      }
    }
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user._id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});