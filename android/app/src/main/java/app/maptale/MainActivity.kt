// Einzige Activity — alles Weitere ist Compose-Navigation.
package app.maptale

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.maptale.tracker.TrackerReturn
import app.maptale.ui.MaptaleNavigation
import app.maptale.ui.MaptaleTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Kalter Start über den Deep Link (die App lief nicht mehr)
        TrackerReturn.report(intent?.dataString)
        // Fest auf „dunkler Untergrund“ — die App ist immer dunkel. Ohne die
        // Angabe richtet sich die Uhr- und Symbolfarbe der Systemleisten nach
        // dem Systemthema und wäre bei hellem System schwarz auf schwarz.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent {
            MaptaleTheme {
                MaptaleNavigation()
            }
        }
    }

    /**
     * Der Regelfall: Die App lief noch, der Browser reicht den Rückweg herein.
     *
     * `setIntent` ist Pflicht — ohne das liefert `getIntent()` weiterhin den
     * Start-Intent, und ein zweites Verknüpfen im selben App-Leben käme nie an.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        TrackerReturn.report(intent.dataString)
    }
}
