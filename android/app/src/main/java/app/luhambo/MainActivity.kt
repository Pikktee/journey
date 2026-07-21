// Einzige Activity — alles Weitere ist Compose-Navigation.
package app.luhambo

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.luhambo.ui.LuhamboNavigation
import app.luhambo.ui.LuhamboTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Fest auf „dunkler Untergrund“ — die App ist immer dunkel. Ohne die
        // Angabe richtet sich die Uhr- und Symbolfarbe der Systemleisten nach
        // dem Systemthema und wäre bei hellem System schwarz auf schwarz.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent {
            LuhamboTheme {
                LuhamboNavigation()
            }
        }
    }
}
