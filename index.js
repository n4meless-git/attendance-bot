require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || message.content !== "출근") return;

    const userId = message.author.id;
    const username = message.author.username;
    
    // 한국 시간 0시 기준 설정
    const now = new Date();
    const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const today = kstDate.toISOString().split('T')[0];

    try {
        // [수정] 테이블의 실제 컬럼명인 last_checkin 사용
        const { data: user, error: selectError } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (selectError) throw selectError;

        // 1. 이미 오늘 출근했는지 확인
        if (user && user.last_checkin === today) {
            return message.reply(`이미 오늘 출근하셨어요! ✨\n(인식된 날짜: ${today})`);
        }

        // 2. 연속 출근 계산
        let newStreak = 1;
        if (user && user.last_checkin) {
            const yesterday = new Date(kstDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (user.last_checkin === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        // 3. 데이터 저장 (last_checkin 이름으로!)
        const { error: upsertError } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                username: username,
                last_checkin: today,
                streak: newStreak
            }, { onConflict: 'user_id' });

        if (upsertError) throw upsertError;

        message.reply(`✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥\n(봇 인식 시각: ${today} 00:00 이후)`);

    } catch (err) {
        console.error(err);
        message.reply("⚠️ 오류 발생! 로그를 확인하세요.");
    }
});

client.login(process.env.DISCORD_TOKEN);
