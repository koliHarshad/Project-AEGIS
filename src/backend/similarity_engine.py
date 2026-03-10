import math

class HistoricalMatcher:
    def __init__(self):
        # 1. Tighter ranges for normalization. 
        # A difference of 800 km/s is now considered a 100% mismatch for speed.
        self.ranges = [9.0, 40.0, 800.0, 25.0] # [Kp, Bz, Speed, Density]
        
        # 2. Physics-Heavy Weights for the Failsafe:
        # Kp(10%), Bz(40%), Speed(35%), Density(15%)
        self.weights = [0.10, 0.40, 0.35, 0.15]

    def calculate_similarity(self, live_data, hist_data):
        penalty = 0.0
        
        for i in range(4):
            # Calculate absolute difference (using abs for Bz magnitude)
            diff = abs(abs(live_data[i]) - abs(hist_data[i]))
            
            # Normalize diff against our tighter ranges and cap at 1.0 (100% mismatch)
            norm_diff = min(1.0, diff / self.ranges[i])
            
            # Linear penalty (Manhattan Distance) - No squaring!
            penalty += self.weights[i] * norm_diff
            
        # 3. THE STRICTNESS MULTIPLIER
        # We multiply the penalty by 1.8 to aggressively punish moderate differences.
        # This forces loose matches to drop fast.
        strict_penalty = min(1.0, penalty * 1.8)
        
        similarity = max(0.0, 1.0 - strict_penalty)
        return round(similarity * 100, 1)

matcher = HistoricalMatcher()